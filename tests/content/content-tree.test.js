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

// Shared mock factory for the #sources-list element and its shadow-root host.
// Supports the queries that computeDropIntent makes:
//   - rootElement.querySelectorAll('.group-container')   → all containers recursively
//   - rootElement.querySelectorAll(':scope > .group-container, :scope > .source-item') → root direct children
//   - rootElement.querySelector(`[data-source-key="..."]`) → element lookup for highlight
//   - rootElement.querySelectorAll('.drag-into, .drag-invalid') → cleanup sweep
//   - container.querySelector('.group-header'/.group-children) → bounds detection
//   - container's `.group-children`.querySelectorAll(':scope > .group-container, :scope > .source-item')
//     → slot scan inside a group
//
// items: top-level entries; each is:
//   { kind: 'source', key, top, height? }
//   { kind: 'group', id, top, headerHeight?, childrenStart?, childrenEnd?, children? }
//
// `top` is viewport-Y of the element's top. For groups, `childrenStart` / `childrenEnd`
// default to `top + headerHeight` / `childrenStart` respectively (empty children band).
function makeMockClassList(initial = []) {
    const classes = new Set(initial);
    return {
        add: jest.fn((...cs) => cs.forEach((c) => classes.add(c))),
        remove: jest.fn((...cs) => cs.forEach((c) => classes.delete(c))),
        contains: (c) => classes.has(c),
        has: (c) => classes.has(c)
    };
}
function makeMockShadowList({ items = [], ungroupedSection = null, listRect = { top: 0, bottom: 1000, height: 1000 } } = {}) {
    const elementMap = new Map();
    const rootChildren = [];
    const allContainers = [];

    // translateY(Npx) parser — mirrors content-drag-reflow.js extractInlineTranslateY.
    function parseTranslateY(t) {
        if (typeof t !== 'string') return 0;
        const m = t.match(/translateY\((-?\d+(?:\.\d+)?)px\)/);
        return m ? parseFloat(m[1]) : 0;
    }

    function buildSource(item, ancestorShift = 0) {
        const height = typeof item.height === 'number' ? item.height : 40;
        // Authored coords are LAYOUT; getBoundingClientRect reflects the element's OWN
        // transform PLUS every ancestor container's transform (as a real browser does).
        const shift = ancestorShift + parseTranslateY(item.transform);
        const top = item.top + shift;
        const bottom = top + height;
        const el = {
            classList: makeMockClassList(['source-item']),
            dataset: { sourceKey: item.key },
            style: typeof item.transform === 'string' ? { transform: item.transform } : {},
            rect: { top, bottom, height, left: 0, right: 200, width: 200 },
            getBoundingClientRect() { return this.rect; }
        };
        elementMap.set('source:' + item.key, el);
        return el;
    }

    function buildGroup(item, ancestorShift = 0) {
        const headerHeight = typeof item.headerHeight === 'number' ? item.headerHeight : 32;
        // Total shift carried by this container = ancestors' transforms + this container's
        // OWN transform. Its descendants (header / children / nested items) inherit this
        // whole sum in getBoundingClientRect but carry NO own inline transform — exactly
        // the condition that exposes the ancestor-transform read bug (the header/children
        // bands must subtract the container's own shift to recover layout coords).
        const shift = ancestorShift + parseTranslateY(item.transform);
        const layoutTop = item.top;
        const layoutChildrenStart = typeof item.childrenStart === 'number' ? item.childrenStart : (layoutTop + headerHeight);
        const layoutChildrenEnd = typeof item.childrenEnd === 'number' ? item.childrenEnd : layoutChildrenStart;
        const top = layoutTop + shift;
        const childrenStart = layoutChildrenStart + shift;
        const childrenEnd = layoutChildrenEnd + shift;
        const bottom = childrenEnd;

        const childElements = [];
        (Array.isArray(item.children) ? item.children : []).forEach((child) => {
            const childEl = build(child, shift);
            if (childEl) childElements.push(childEl);
        });

        const headerEl = {
            classList: makeMockClassList(['group-header']),
            style: {},
            rect: { top, bottom: childrenStart, height: childrenStart - top, left: 0, right: 200, width: 200 },
            getBoundingClientRect() { return this.rect; }
        };
        const childrenEl = {
            classList: makeMockClassList(['group-children']),
            style: { setProperty: jest.fn(), removeProperty: jest.fn() },
            rect: { top: childrenStart, bottom: childrenEnd, height: childrenEnd - childrenStart, left: 0, right: 200, width: 200 },
            getBoundingClientRect() { return this.rect; },
            querySelectorAll(selector) {
                if (selector === ':scope > .group-container, :scope > .source-item') {
                    return childElements;
                }
                return [];
            }
        };
        const container = {
            classList: makeMockClassList(['group-container']),
            dataset: { groupId: item.id },
            style: typeof item.transform === 'string' ? { transform: item.transform } : {},
            rect: { top, bottom, height: bottom - top, left: 0, right: 200, width: 200 },
            getBoundingClientRect() { return this.rect; },
            querySelector(selector) {
                if (selector === '.group-header') return headerEl;
                if (selector === '.group-children') return childrenEl;
                return null;
            },
            querySelectorAll() { return []; },
            _children: childElements
        };
        elementMap.set('group:' + item.id, container);
        allContainers.push(container);
        return container;
    }

    function build(item, ancestorShift = 0) {
        if (!item) return null;
        if (item.kind === 'source') return buildSource(item, ancestorShift);
        if (item.kind === 'group') return buildGroup(item, ancestorShift);
        return null;
    }

    items.forEach((item) => {
        const el = build(item, 0);
        if (el) rootChildren.push(el);
    });

    function recurseContainers(els) {
        els.forEach((el) => {
            if (el.classList && el.classList.contains('group-container')) {
                if (el._children) recurseContainers(el._children);
            }
        });
    }
    recurseContainers(rootChildren);

    // Optional non-empty "Ungrouped" bin region. Rendered by render() as a sibling
    // <div class="ungrouped-section"> (header + the bin's .source-item rows), so the
    // bin items are NOT direct children of #sources-list. `bounds` is the section's
    // own rect; `items` are { key, top, height? } in state.ungrouped order.
    let ungroupedSectionEl = null;
    if (ungroupedSection) {
        const binItemEls = (Array.isArray(ungroupedSection.items) ? ungroupedSection.items : []).map((it) => {
            const height = typeof it.height === 'number' ? it.height : 40;
            const top = it.top;
            const el = {
                classList: makeMockClassList(['source-item']),
                dataset: { sourceKey: it.key },
                style: {},
                rect: { top, bottom: top + height, height, left: 0, right: 200, width: 200 },
                getBoundingClientRect() { return this.rect; }
            };
            elementMap.set('source:' + it.key, el);
            return el;
        });
        const b = ungroupedSection.bounds || { top: 0, bottom: 0, height: 0 };
        ungroupedSectionEl = {
            classList: makeMockClassList(['ungrouped-section']),
            style: {},
            rect: { top: b.top, bottom: b.bottom, height: typeof b.height === 'number' ? b.height : (b.bottom - b.top), left: 0, right: 200, width: 200 },
            getBoundingClientRect() { return this.rect; },
            querySelectorAll(selector) {
                if (selector === ':scope > .source-item') return binItemEls.slice();
                return [];
            }
        };
    }

    const sourcesListEl = {
        id: 'sources-list',
        getBoundingClientRect: () => ({
            top: listRect.top,
            bottom: listRect.bottom,
            height: listRect.height,
            left: 0,
            right: 200,
            width: 200
        }),
        querySelector(selector) {
            if (selector === '.ungrouped-section') return ungroupedSectionEl;
            let m = selector.match(/\[data-source-key="([^"]+)"\]/);
            if (m) return elementMap.get('source:' + m[1]) || null;
            m = selector.match(/\[data-group-id="([^"]+)"\]/);
            if (m) return elementMap.get('group:' + m[1]) || null;
            return null;
        },
        querySelectorAll(selector) {
            if (selector === '.group-container') return allContainers.slice();
            if (selector === ':scope > .group-container, :scope > .source-item') return rootChildren.slice();
            if (selector === '.drag-into, .drag-invalid') {
                const out = [];
                allContainers.forEach((c) => {
                    if (c.classList.has('drag-into') || c.classList.has('drag-invalid')) out.push(c);
                });
                rootChildren.forEach((c) => {
                    if (c.classList && c.classList.has && (c.classList.has('drag-into') || c.classList.has('drag-invalid'))) {
                        if (!out.includes(c)) out.push(c);
                    }
                });
                return out;
            }
            if (selector === '.drag-invalid') {
                const out = [];
                allContainers.forEach((c) => {
                    if (c.classList.has('drag-invalid')) out.push(c);
                });
                rootChildren.forEach((c) => {
                    if (c.classList && c.classList.has && c.classList.has('drag-invalid')) {
                        if (!out.includes(c)) out.push(c);
                    }
                });
                return out;
            }
            return [];
        }
    };

    const shadowRoot = {
        getElementById: (id) => (id === 'sources-list' ? sourcesListEl : null),
        querySelector: () => null,
        querySelectorAll: () => []
    };

    return { sourcesListEl, shadowRoot, elementMap, rootChildren, allContainers };
}

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

    it('removes a top-level group from state.root', () => {
        mod.state.root = [{ type: 'group', id: 'group1' }, { type: 'group', id: 'group2' }, { type: 'group', id: 'group3' }];
        mod.removeGroupFromTree('group2');
        expect(mod.state.root).toEqual([{ type: 'group', id: 'group1' }, { type: 'group', id: 'group3' }]);
    });

    it('removes a nested group from its parent children array', () => {
        const parentGroup = { id: 'parent1', children: [{ id: 'child1' }, { id: 'child2' }] };
        mod.groupsById.set('parent1', parentGroup);

        mod.removeGroupFromTree('child1');

        expect(parentGroup.children).toEqual([{ id: 'child2' }]);
    });

    it('removes a group from both state.root and parent children if present in both', () => {
        mod.state.root = [{ type: 'group', id: 'group1' }, { type: 'group', id: 'orphanChild' }];
        const parentGroup = { id: 'parent1', children: [{ id: 'orphanChild' }, { id: 'other' }] };
        mod.groupsById.set('parent1', parentGroup);

        mod.removeGroupFromTree('orphanChild');

        expect(mod.state.root).toEqual([{ type: 'group', id: 'group1' }]);
        expect(parentGroup.children).toEqual([{ id: 'other' }]);
    });

    it('does nothing if group id is not found', () => {
        mod.state.root = [{ type: 'group', id: 'group1' }];
        const parentGroup = { id: 'parent1', children: [{ id: 'child1' }] };
        mod.groupsById.set('parent1', parentGroup);

        mod.removeGroupFromTree('nonExistent');

        expect(mod.state.root).toEqual([{ type: 'group', id: 'group1' }]);
        expect(parentGroup.children).toEqual([{ id: 'child1' }]);
    });

    it('tolerates persisted groups that are missing children arrays', () => {
        mod.state.root = [{ type: 'group', id: 'group1' }];
        const parentGroup = { id: 'parent1' };
        mod.groupsById.set('parent1', parentGroup);

        expect(() => mod.removeGroupFromTree('group1')).not.toThrow();

        expect(mod.state.root).toEqual([]);
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
        const state = { root: [], ungrouped: [] };
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

        expect(state.root).toEqual([
            { type: 'group', id: 'group_12345' },
            { type: 'group', id: 'group_12345_1' }
        ]);
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

    it('removeSourceFromTree drops a positioned root source out of state.root', () => {
        const state = {
            root: [
                { type: 'group', id: 'g1' },
                { type: 'source', key: 'src-pos' },
                { type: 'source', key: 'src-keep' }
            ],
            ungrouped: ['bin-1']
        };
        const interactions = createContentTreeInteractions({
            getState: () => state,
            getGroupsById: () => new Map(),
            getParentMap: () => new Map()
        });

        interactions.removeSourceFromTree('src-pos');

        expect(state.root).toEqual([
            { type: 'group', id: 'g1' },
            { type: 'source', key: 'src-keep' }
        ]);
        // bin untouched
        expect(state.ungrouped).toEqual(['bin-1']);
    });

    it('removeSourceFromTree still drops a bin source out of state.ungrouped', () => {
        const state = { root: [{ type: 'source', key: 'src-keep' }], ungrouped: ['bin-1', 'bin-2'] };
        const interactions = createContentTreeInteractions({
            getState: () => state,
            getGroupsById: () => new Map(),
            getParentMap: () => new Map()
        });
        interactions.removeSourceFromTree('bin-1');
        expect(state.ungrouped).toEqual(['bin-2']);
        expect(state.root).toEqual([{ type: 'source', key: 'src-keep' }]);
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
                currentIntent: {
                    kind: 'before-source',
                    targetGroup: null,
                    targetList: state.ungrouped,
                    insertIndex: 0,
                    targetGroupId: null,
                    slotKey: 'source-1'
                },
                shiftedItems: new Map()
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
                currentIntent: {
                    kind: 'after-source',
                    targetGroup: null,
                    targetList: state.ungrouped,
                    insertIndex: 2,
                    targetGroupId: null,
                    slotKey: 'source-2'
                },
                shiftedItems: new Map()
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

    it('handleDrop splices a dragged source into state.root as a {type:source} entry', () => {
        const state = {
            root: [
                { type: 'group', id: 'g1' },
                { type: 'group', id: 'g2' }
            ],
            ungrouped: ['mover']
        };
        const saveState = jest.fn();
        const render = jest.fn();
        const buildParentMap = jest.fn();
        const dropTarget = {
            dataset: { groupId: 'g2' },
            classList: createClassList(['group-container'])
        };
        const runtime = {
            dragReflowSession: {
                draggedKeys: new Set(['mover']),
                currentIntent: {
                    kind: 'before-group',
                    targetGroup: null,
                    targetList: state.root,
                    insertIndex: 1, // before g2 in state.root
                    targetGroupId: null,
                    slotKey: 'g2'
                },
                shiftedItems: new Map()
            }
        };
        const interactions = createContentTreeInteractions({
            runtime,
            getState: () => state,
            getGroupsById: () => new Map([['g1', { id: 'g1', children: [] }], ['g2', { id: 'g2', children: [] }]]),
            getParentMap: () => new Map(),
            getShadowRoot: () => ({ querySelectorAll: jest.fn(() => []) }),
            saveState,
            render,
            buildParentMap
        });

        interactions.handleDrop(createDropEvent({ dropTarget, sourceKey: 'mover' }));

        expect(state.root).toEqual([
            { type: 'group', id: 'g1' },
            { type: 'source', key: 'mover' },
            { type: 'group', id: 'g2' }
        ]);
        // 'mover' was pulled out of the bin
        expect(state.ungrouped).toEqual([]);
        expect(saveState).toHaveBeenCalledWith({ immediate: true, critical: true });
        expect(render).toHaveBeenCalledTimes(1);
    });

    it('handleDrop splices a dragged group into state.root as a {type:group} entry', () => {
        const state = {
            root: [
                { type: 'source', key: 'A' },
                { type: 'group', id: 'g1' }
            ],
            ungrouped: []
        };
        const groupsById = new Map([
            ['g1', { id: 'g1', children: [] }],
            ['mover', { id: 'mover', children: [] }]
        ]);
        const saveState = jest.fn();
        const render = jest.fn();
        const buildParentMap = jest.fn();
        const dropTarget = { dataset: { sourceKey: 'A' }, classList: createClassList(['source-item']) };
        const runtime = {
            dragReflowSession: {
                draggedKeys: new Set(['mover']),
                currentIntent: {
                    kind: 'before-source',
                    targetGroup: null,
                    targetList: state.root,
                    insertIndex: 0, // before A in state.root
                    targetGroupId: null,
                    slotKey: 'A'
                },
                shiftedItems: new Map()
            }
        };
        // 'mover' starts as a root group at index 1; moving it before A.
        state.root.push({ type: 'group', id: 'mover' });
        const interactions = createContentTreeInteractions({
            runtime,
            getState: () => state,
            getGroupsById: () => groupsById,
            getParentMap: () => new Map(),
            getShadowRoot: () => ({ querySelectorAll: jest.fn(() => []) }),
            isDescendant: global.isDescendant,
            saveState,
            render,
            buildParentMap
        });

        interactions.handleDrop(createDropEvent({ dropTarget, groupId: 'mover' }));

        expect(state.root).toEqual([
            { type: 'group', id: 'mover' },
            { type: 'source', key: 'A' },
            { type: 'group', id: 'g1' }
        ]);
        expect(saveState).toHaveBeenCalledWith({ immediate: true, critical: true });
    });

    it('does not save or render when a positioned root source is dropped back into its own slot', () => {
        const state = {
            root: [
                { type: 'source', key: 'src-1' },
                { type: 'group', id: 'g1' },
                { type: 'source', key: 'src-2' }
            ],
            ungrouped: []
        };
        const saveState = jest.fn();
        const render = jest.fn();
        const dropTarget = { dataset: { sourceKey: 'src-1' }, classList: createClassList(['source-item']) };
        const runtime = {
            dragReflowSession: {
                draggedKeys: new Set(['src-1']),
                currentIntent: {
                    kind: 'before-source',
                    targetGroup: null,
                    targetList: state.root,
                    insertIndex: 0, // src-1 is already at root index 0
                    targetGroupId: null,
                    slotKey: 'src-1'
                },
                shiftedItems: new Map()
            }
        };
        const interactions = createContentTreeInteractions({
            runtime,
            getState: () => state,
            getGroupsById: () => new Map([['g1', { id: 'g1', children: [] }]]),
            getParentMap: () => new Map(),
            getShadowRoot: () => ({ querySelectorAll: jest.fn(() => []) }),
            saveState,
            render
        });

        interactions.handleDrop(createDropEvent({ dropTarget, sourceKey: 'src-1' }));

        expect(state.root).toEqual([
            { type: 'source', key: 'src-1' },
            { type: 'group', id: 'g1' },
            { type: 'source', key: 'src-2' }
        ]);
        expect(render).not.toHaveBeenCalled();
        expect(saveState).not.toHaveBeenCalled();
    });

    it('does not save or render when a positioned root GROUP is dropped back into its own slot', () => {
        const state = {
            root: [
                { type: 'group', id: 'g1' },
                { type: 'group', id: 'g2' }
            ],
            ungrouped: []
        };
        const saveState = jest.fn();
        const render = jest.fn();
        const dropTarget = { dataset: { groupId: 'g2' }, classList: createClassList(['group-container']) };
        const runtime = {
            dragReflowSession: {
                draggedKeys: new Set(['g2']),
                currentIntent: {
                    kind: 'after-group',
                    targetGroup: null,
                    targetList: state.root,
                    insertIndex: 2, // g2 already last; normalized back to its own index
                    targetGroupId: null,
                    slotKey: 'g2'
                },
                shiftedItems: new Map()
            }
        };
        const interactions = createContentTreeInteractions({
            runtime,
            getState: () => state,
            getGroupsById: () => new Map([['g1', { id: 'g1', children: [] }], ['g2', { id: 'g2', children: [] }]]),
            getParentMap: () => new Map(),
            getShadowRoot: () => ({ querySelectorAll: jest.fn(() => []) }),
            isDescendant: global.isDescendant,
            saveState,
            render
        });

        interactions.handleDrop(createDropEvent({ dropTarget, groupId: 'g2' }));

        expect(state.root).toEqual([
            { type: 'group', id: 'g1' },
            { type: 'group', id: 'g2' }
        ]);
        expect(render).not.toHaveBeenCalled();
        expect(saveState).not.toHaveBeenCalled();
    });

    it('prevents moving a group into itself or its own subtree', () => {
        const state = { root: [{ type: 'group', id: 'root' }], ungrouped: [] };
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

        expect(state.root).toEqual([{ type: 'group', id: 'root' }]);
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
        const state = { root: [{ type: 'group', id: 'root' }], ungrouped: ['source-3'], isBatchMode: true };
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

    // Edit-mode guard: when cursor is inside an editable control (rename input,
    // textarea, contenteditable region), dragstart must not initiate a drag.
    // Otherwise user dragging a text selection across the row's draggable
    // boundary interrupts the edit and starts an unwanted drag.
    it('aborts dragstart when e.target is inside an input (rename / text edit guard)', () => {
        const state = { isBatchMode: false, ungrouped: ['A'], groups: [] };
        const pendingBatchKeys = new Set();
        const sourceRow = createSourceRow('A');
        const dataTransfer = createDataTransfer();
        const preventDefault = jest.fn();
        const fakeInput = { tagName: 'INPUT' };

        const interactions = createContentTreeInteractions({
            getState: () => state,
            getGroupsById: () => new Map(),
            getPendingBatchKeys: () => pendingBatchKeys,
            getShadowRoot: () => null,
            getSetTimeout: () => () => {},
            dragMulti: createContentDragMulti({})
        });

        // closest stub returns the fake input for the editable selector,
        // and source row for .source-item (so without the guard, drag would proceed).
        const closestStub = jest.fn((selector) => {
            if (selector === 'input, textarea, [contenteditable=""], [contenteditable="true"]') return fakeInput;
            if (selector === '.source-item') return sourceRow;
            if (selector === '.group-header') return null;
            return null;
        });

        const event = {
            target: { closest: closestStub },
            dataTransfer,
            preventDefault
        };
        interactions.handleDragStart(event);

        // Guard fires: preventDefault called once, dataTransfer.setData never called.
        expect(preventDefault).toHaveBeenCalledTimes(1);
        expect(dataTransfer.setData).not.toHaveBeenCalled();
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

    function makeShadowRootWithList() {
        const list = { id: 'sources-list', querySelector: () => null, querySelectorAll: () => [] };
        return {
            getElementById: (id) => (id === 'sources-list' ? list : null),
            querySelector: () => null,
            querySelectorAll: () => []
        };
    }

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
        const runtime = {
            dragReflowSession: {
                draggedKeys: new Set(['A', 'B', 'C']),
                currentIntent: {
                    kind: 'into-group',
                    targetGroup: group,
                    targetList: group.children,
                    insertIndex: -1,
                    targetGroupId: 'g1',
                    slotKey: null
                },
                shiftedItems: new Map()
            }
        };
        const interactions = createContentTreeInteractions({
            runtime,
            getState: () => state,
            getGroupsById: () => groupsById,
            getSourcesByKey: () => sourcesByKey,
            getParentMap: () => new Map(),
            getPendingBatchKeys: () => pendingBatchKeys,
            getShadowRoot: makeShadowRootWithList,
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

    it('routes a multi-key drop between two root groups into state.root (not the bin)', () => {
        const g1 = { id: 'g1', children: [] };
        const g2 = { id: 'g2', children: [] };
        const state = {
            isBatchMode: true,
            ungrouped: ['A', 'B'],
            root: [{ type: 'group', id: 'g1' }, { type: 'group', id: 'g2' }]
        };
        const groupsById = new Map([['g1', g1], ['g2', g2]]);
        const sourcesByKey = new Map([['A', { key: 'A' }], ['B', { key: 'B' }]]);
        const pendingBatchKeys = new Set(['A', 'B']);
        const saveState = jest.fn();
        const render = jest.fn();
        const showToast = jest.fn();
        const buildParentMap = jest.fn();
        const developerLog = jest.fn();
        const runtime = {
            dragReflowSession: {
                draggedKeys: new Set(['A', 'B']),
                // Drop between root groups g1 and g2 → before-group g2 against state.root.
                currentIntent: {
                    kind: 'before-group',
                    targetGroup: null,
                    targetList: state.root,
                    insertIndex: 1,
                    isRootList: true,
                    slotKey: 'g2'
                },
                shiftedItems: new Map()
            }
        };
        const interactions = createContentTreeInteractions({
            runtime,
            getState: () => state,
            getGroupsById: () => groupsById,
            getSourcesByKey: () => sourcesByKey,
            getParentMap: () => new Map(),
            getPendingBatchKeys: () => pendingBatchKeys,
            getShadowRoot: makeShadowRootWithList,
            saveState,
            render,
            showToast,
            buildParentMap,
            developerLog,
            dragMulti: createContentDragMulti({}),
            getMessage: (key, args = []) => `${key}:${args.join(',')}`
        });

        interactions.handleDrop(createDropEvent({
            dropTarget: null,
            sourceKey: 'A',
            sourceKeysJson: JSON.stringify(['A', 'B'])
        }));

        // The two positioned sources land between g1 and g2 in state.root; the bin is emptied.
        expect(state.root).toEqual([
            { type: 'group', id: 'g1' },
            { type: 'source', key: 'A' },
            { type: 'source', key: 'B' },
            { type: 'group', id: 'g2' }
        ]);
        expect(state.ungrouped).toEqual([]);
        expect(state.isBatchMode).toBe(false);
        expect(showToast).toHaveBeenCalledTimes(1);
        expect(saveState).toHaveBeenCalledWith({ immediate: true, critical: true });
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
                currentIntent: {
                    kind: 'before-source',
                    targetGroup: null,
                    targetList: state.ungrouped,
                    insertIndex: 0,
                    targetGroupId: null,
                    slotKey: 'A'
                },
                shiftedItems: new Map()
            }
        };
        const interactions = createContentTreeInteractions({
            runtime,
            getState: () => state,
            getGroupsById: () => groupsById,
            getSourcesByKey: () => sourcesByKey,
            getParentMap: () => new Map(),
            getPendingBatchKeys: () => pendingBatchKeys,
            getShadowRoot: makeShadowRootWithList,
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

    it('single-source drop moves a source from group A to group B children, updating both groups consistently', () => {
        const groupA = { id: 'gA', children: [{ type: 'source', key: 'A1' }, { type: 'source', key: 'A2' }] };
        const groupB = { id: 'gB', children: [{ type: 'source', key: 'B1' }] };
        const state = { isBatchMode: false, ungrouped: [], groups: ['gA', 'gB'] };
        const groupsById = new Map([['gA', groupA], ['gB', groupB]]);
        const sourcesByKey = new Map([
            ['A1', { key: 'A1' }],
            ['A2', { key: 'A2' }],
            ['B1', { key: 'B1' }]
        ]);
        const parentMap = new Map([['A1', 'gA'], ['A2', 'gA'], ['B1', 'gB']]);
        const buildParentMap = jest.fn();
        const dropTarget = {
            dataset: { sourceKey: 'B1' },
            classList: createClassList(['source-item'])
        };
        const runtime = {
            dragReflowSession: {
                draggedKeys: new Set(['A1']),
                currentIntent: {
                    kind: 'after-source',
                    targetGroup: groupB,
                    targetList: groupB.children,
                    insertIndex: 1,
                    targetGroupId: 'gB',
                    slotKey: 'B1'
                },
                shiftedItems: new Map()
            }
        };
        const interactions = createContentTreeInteractions({
            runtime,
            getState: () => state,
            getGroupsById: () => groupsById,
            getSourcesByKey: () => sourcesByKey,
            getParentMap: () => parentMap,
            getPendingBatchKeys: () => new Set(),
            getShadowRoot: makeShadowRootWithList,
            saveState: jest.fn(),
            render: jest.fn(),
            showToast: jest.fn(),
            buildParentMap,
            developerLog: jest.fn(),
            dragMulti: createContentDragMulti({}),
            getMessage: (key, args = []) => `${key}:${args.join(',')}`
        });

        interactions.handleDrop(createDropEvent({
            dropTarget,
            sourceKey: 'A1'
        }));

        // A1 removed from group A, appended after B1 in group B.
        expect(groupA.children).toEqual([{ type: 'source', key: 'A2' }]);
        expect(groupB.children).toEqual([
            { type: 'source', key: 'B1' },
            { type: 'source', key: 'A1' }
        ]);
        // parentMap rebuild is the contract for keeping subsequent drag lookups
        // (findParentGroupOfSource) consistent with the new tree shape.
        expect(buildParentMap).toHaveBeenCalled();
    });

    it('preserves batch selection when dragging an unselected source while batch mode is on', () => {
        // Batch mode is on with A and B selected, but the user drags C (not in
        // the selection). resolveDragSelection should fall back to origin-only,
        // so the drop must NOT exit batch mode or clear pending selections —
        // batch state is preserved for the user's next action.
        const state = { isBatchMode: true, ungrouped: ['A', 'B', 'C', 'D'], groups: [] };
        const groupsById = new Map();
        const sourcesByKey = new Map([
            ['A', { key: 'A' }],
            ['B', { key: 'B' }],
            ['C', { key: 'C' }],
            ['D', { key: 'D' }]
        ]);
        const pendingBatchKeys = new Set(['A', 'B']);
        const dropTarget = {
            dataset: { sourceKey: 'D' },
            classList: createClassList(['source-item'])
        };
        // Single-source drag intent (resolveDragSelection returned [C] only).
        const runtime = {
            dragReflowSession: {
                draggedKeys: new Set(['C']),
                currentIntent: {
                    kind: 'after-source',
                    targetGroup: null,
                    targetList: state.ungrouped,
                    insertIndex: 4,
                    targetGroupId: null,
                    slotKey: 'D'
                },
                shiftedItems: new Map()
            }
        };
        const interactions = createContentTreeInteractions({
            runtime,
            getState: () => state,
            getGroupsById: () => groupsById,
            getSourcesByKey: () => sourcesByKey,
            getParentMap: () => new Map(),
            getPendingBatchKeys: () => pendingBatchKeys,
            getShadowRoot: makeShadowRootWithList,
            saveState: jest.fn(),
            render: jest.fn(),
            showToast: jest.fn(),
            buildParentMap: jest.fn(),
            developerLog: jest.fn(),
            dragMulti: createContentDragMulti({}),
            getMessage: (key, args = []) => `${key}:${args.join(',')}`
        });

        // Note: sourceKeysJson is intentionally absent — the dragstart fell back
        // to origin-only and only wrote application/source-key.
        interactions.handleDrop(createDropEvent({
            dropTarget,
            sourceKey: 'C'
        }));

        // C reordered to after D in ungrouped.
        expect(state.ungrouped).toEqual(['A', 'B', 'D', 'C']);
        // Batch mode + selection survived the single-source drag/drop.
        expect(state.isBatchMode).toBe(true);
        expect(pendingBatchKeys.has('A')).toBe(true);
        expect(pendingBatchKeys.has('B')).toBe(true);
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
        const runtime = {
            dragReflowSession: {
                draggedKeys: new Set(['A']),
                currentIntent: {
                    kind: 'into-group',
                    targetGroup: group,
                    targetList: group.children,
                    insertIndex: -1,
                    targetGroupId: 'g1',
                    slotKey: null
                },
                shiftedItems: new Map()
            }
        };
        const interactions = createContentTreeInteractions({
            runtime,
            getState: () => state,
            getGroupsById: () => groupsById,
            getSourcesByKey: () => sourcesByKey,
            getParentMap: () => new Map(),
            getPendingBatchKeys: () => new Set(),
            getShadowRoot: makeShadowRootWithList,
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
        const runtime = {
            dragReflowSession: {
                draggedKeys: new Set(['A', 'B', 'C']),
                currentIntent: {
                    kind: 'into-group',
                    targetGroup: group,
                    targetList: group.children,
                    insertIndex: -1,
                    targetGroupId: 'g1',
                    slotKey: null
                },
                shiftedItems: new Map()
            }
        };
        const interactions = createContentTreeInteractions({
            runtime,
            getState: () => state,
            getGroupsById: () => groupsById,
            getSourcesByKey: () => sourcesByKey,
            getParentMap: () => new Map(),
            getPendingBatchKeys: () => pendingBatchKeys,
            getShadowRoot: makeShadowRootWithList,
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

    // NOTE: the former v4 test "does not corrupt state.groups when intent is
    // before-group at top level" was removed — it pinned the deleted guard that
    // rejected top-level before/after-group source drops. Under v5 that is a valid
    // positioned root drop, covered by "routes a multi-key drop between two root
    // groups into state.root (not the bin)" above.

    it('single-source drop on folder header lands source at the TOP of existing children (index 0, not end)', () => {
        // Pre-existing folder with two children — we want the dragged source to
        // appear at index 0 (above X1), not appended after X2. This matches the
        // user's mental model of "I dropped this source ON the folder, so it
        // should be the first thing I see when the folder opens".
        const group = { id: 'g1', children: [{ type: 'source', key: 'X1' }, { type: 'source', key: 'X2' }] };
        const state = { isBatchMode: false, ungrouped: ['A'], groups: ['g1'] };
        const groupsById = new Map([['g1', group]]);
        const sourcesByKey = new Map([
            ['A', { key: 'A' }],
            ['X1', { key: 'X1' }],
            ['X2', { key: 'X2' }]
        ]);
        const pendingBatchKeys = new Set();
        const saveState = jest.fn();
        const render = jest.fn();
        const dropTarget = {
            dataset: { groupId: 'g1' },
            classList: createClassList(['group-container', 'drag-into'])
        };
        const runtime = {
            // Mimics the intent computed during dragover when cursor is on g1's header.
            dragReflowSession: {
                draggedKeys: new Set(['A']),
                currentIntent: {
                    kind: 'into-group',
                    targetGroup: group,
                    targetList: group.children,
                    insertIndex: 0,
                    targetGroupId: 'g1',
                    slotKey: null
                },
                shiftedItems: new Map()
            }
        };
        const interactions = createContentTreeInteractions({
            runtime,
            getState: () => state,
            getGroupsById: () => groupsById,
            getSourcesByKey: () => sourcesByKey,
            getParentMap: () => new Map(),
            getPendingBatchKeys: () => pendingBatchKeys,
            getShadowRoot: makeShadowRootWithList,
            saveState,
            render,
            showToast: jest.fn(),
            buildParentMap: jest.fn(),
            developerLog: jest.fn(),
            dragMulti: createContentDragMulti({}),
            getMessage: (key, args = []) => `${key}:${args.join(',')}`
        });

        interactions.handleDrop(createDropEvent({
            dropTarget,
            sourceKey: 'A'
        }));

        // A landed at the TOP of g1's children — index 0, before X1 and X2.
        expect(group.children).toEqual([
            { type: 'source', key: 'A' },
            { type: 'source', key: 'X1' },
            { type: 'source', key: 'X2' }
        ]);
        expect(state.ungrouped).toEqual([]);
    });

    it('multi-source drop on folder header lands batch sources at the TOP preserving their order', () => {
        // Batch of three sources dropped into a folder with one existing child.
        // Expected: A, B, C all land at the TOP (before X), preserving A→B→C order.
        const group = { id: 'g1', children: [{ type: 'source', key: 'X' }] };
        const state = { isBatchMode: true, ungrouped: ['A', 'B', 'C'], groups: ['g1'] };
        const groupsById = new Map([['g1', group]]);
        const sourcesByKey = new Map([
            ['A', { key: 'A' }],
            ['B', { key: 'B' }],
            ['C', { key: 'C' }],
            ['X', { key: 'X' }]
        ]);
        const pendingBatchKeys = new Set(['A', 'B', 'C']);
        const saveState = jest.fn();
        const render = jest.fn();
        const dropTarget = {
            dataset: { groupId: 'g1' },
            classList: createClassList(['group-container', 'drag-into'])
        };
        const runtime = {
            dragReflowSession: {
                draggedKeys: new Set(['A', 'B', 'C']),
                currentIntent: {
                    kind: 'into-group',
                    targetGroup: group,
                    targetList: group.children,
                    insertIndex: 0,
                    targetGroupId: 'g1',
                    slotKey: null
                },
                shiftedItems: new Map()
            }
        };
        const interactions = createContentTreeInteractions({
            runtime,
            getState: () => state,
            getGroupsById: () => groupsById,
            getSourcesByKey: () => sourcesByKey,
            getParentMap: () => new Map(),
            getPendingBatchKeys: () => pendingBatchKeys,
            getShadowRoot: makeShadowRootWithList,
            saveState,
            render,
            showToast: jest.fn(),
            buildParentMap: jest.fn(),
            developerLog: jest.fn(),
            dragMulti: createContentDragMulti({}),
            getMessage: (key, args = []) => `${key}:${args.join(',')}`
        });

        interactions.handleDrop(createDropEvent({
            dropTarget,
            sourceKey: 'A',
            sourceKeysJson: JSON.stringify(['A', 'B', 'C'])
        }));

        // Batch lands at top in the order A→B→C (preserved), with X following.
        expect(group.children).toEqual([
            { type: 'source', key: 'A' },
            { type: 'source', key: 'B' },
            { type: 'source', key: 'C' },
            { type: 'source', key: 'X' }
        ]);
        expect(state.ungrouped).toEqual([]);
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

        // foldDraggedItems should not be called synchronously — running fold inside
        // dragstart turns the drag source into a 0×0 + pointer-events:none box before
        // Chrome finalizes drag initiation, and Chrome silently cancels the drag.
        // The RAF defer keeps fold off the dragstart paint, so drag starts cleanly.
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

    // Stability: dragend isn't always guaranteed (window blur, Esc race, page nav
    // can interrupt before the cleanup handler fires). The next dragstart's
    // preflight is the only chance to recover from leaked class state. The
    // dangerous leak is .sp-drag-folded — it keeps a row at height:0 +
    // opacity:0 + pointer-events:none, manifesting as "I can't drag this
    // source anymore" to the user. Symmetric for .sp-drop-shift on siblings
    // (lingering translateY offsets) and runtime.dragReflowSession (stale
    // tracking).
    it('preflight strips lingering .sp-drag-folded / .sp-drop-shift state and resets stale dragReflowSession', () => {
        const runtime = {
            // Pre-set stale session from a prior interrupted drag.
            dragReflowSession: { draggedKeys: new Set(['old']), itemHeights: new Map(), totalDraggedHeight: 0, shiftedItems: new Map(), stale: true }
        };
        const state = { isBatchMode: false, ungrouped: ['A', 'B', 'C'], groups: [] };
        const pendingBatchKeys = new Set();
        const sourceRowA = createSourceRow('A');

        // Stale source B: stuck folded (invisible, un-draggable).
        const staleStyleB = { height: '0px', opacity: '0' };
        const staleClassListB = { contains: jest.fn(() => false), add: jest.fn(), remove: jest.fn() };
        const staleB = { dataset: { sourceKey: 'B' }, classList: staleClassListB, style: staleStyleB };

        // Stale sibling C: lingering translateY offset.
        const staleStyleC = { transform: 'translateY(40px)' };
        const staleClassListC = { contains: jest.fn(() => false), add: jest.fn(), remove: jest.fn() };
        const staleC = { dataset: { sourceKey: 'C' }, classList: staleClassListC, style: staleStyleC };

        const sourcesListEl = {
            id: 'sources-list',
            querySelectorAll: jest.fn((selector) => {
                if (selector === '.sp-drag-folded') return [staleB];
                if (selector === '.sp-drop-shift') return [staleC];
                return [];
            })
        };
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
            target: createSourceRowTargetStub(sourceRowA),
            dataTransfer: createDataTransfer()
        };
        interactions.handleDragStart(event);

        // B's stuck-folded state is cleared — class removed + inline height/opacity reset.
        expect(staleClassListB.remove).toHaveBeenCalledWith('sp-drag-folded');
        expect(staleStyleB.height).toBe('');
        expect(staleStyleB.opacity).toBe('');

        // C's lingering shift is cleared — class removed + inline transform reset.
        expect(staleClassListC.remove).toHaveBeenCalledWith('sp-drop-shift');
        expect(staleStyleC.transform).toBe('');

        // Stale dragReflowSession reference replaced by the new drag's fresh session.
        expect(runtime.dragReflowSession).not.toBe(undefined);
        expect(runtime.dragReflowSession.stale).not.toBe(true);
        expect(runtime.dragReflowSession.draggedKeys.has('A')).toBe(true);
    });

    it('preflight strips lingering .sp-drag-active / .sp-hover-expand-pending / .sp-drag-cancelled', () => {
        const runtime = { dragReflowSession: null };
        const state = { isBatchMode: false, ungrouped: ['A'], groups: [] };
        const pendingBatchKeys = new Set();
        const sourceRowA = createSourceRow('A');

        // Cues left armed when a prior drag was interrupted by tab-switch / blur:
        // a group-container's hover-expand build-up + a source-item's cancel shake.
        const stalePending = { classList: { contains: jest.fn(() => false), add: jest.fn(), remove: jest.fn() }, style: {} };
        const staleCancelled = { classList: { contains: jest.fn(() => false), add: jest.fn(), remove: jest.fn() }, style: {} };

        // .sp-drag-active lives on #sources-list itself (the host), not a descendant.
        const listClassList = { contains: jest.fn(() => true), add: jest.fn(), remove: jest.fn() };
        // .sp-drag-guide is a descendant group-children left over from an interrupted drag.
        const staleGuide = {
            classList: { contains: jest.fn(() => true), add: jest.fn(), remove: jest.fn() },
            style: { removeProperty: jest.fn() }
        };
        const sourcesListEl = {
            id: 'sources-list',
            classList: listClassList,
            querySelectorAll: jest.fn((selector) => {
                if (selector.includes('sp-hover-expand-pending')) return [stalePending, staleCancelled];
                if (selector === '.sp-drag-guide') return [staleGuide];
                return [];
            })
        };
        const shadowRoot = {
            querySelector: jest.fn(() => null),
            querySelectorAll: jest.fn(() => []),
            getElementById: jest.fn((id) => (id === 'sources-list' ? sourcesListEl : null))
        };

        const interactions = createContentTreeInteractions({
            runtime,
            getState: () => state,
            getGroupsById: () => new Map(),
            getPendingBatchKeys: () => pendingBatchKeys,
            getShadowRoot: () => shadowRoot,
            getDocument: () => null,
            getSetTimeout: () => () => {},
            dragMulti: createContentDragMulti({}),
            dragReflow: createDragReflowMock()
        });

        interactions.handleDragStart({
            target: createSourceRowTargetStub(sourceRowA),
            dataTransfer: createDataTransfer()
        });

        // Descendant cues cleared via the preflight querySelectorAll sweep.
        expect(stalePending.classList.remove).toHaveBeenCalledWith('sp-hover-expand-pending');
        expect(staleCancelled.classList.remove).toHaveBeenCalledWith('sp-drag-cancelled');
        // Host-level .sp-drag-active cleared directly on #sources-list.
        expect(listClassList.remove).toHaveBeenCalledWith('sp-drag-active');
        // Descendant .sp-drag-guide left-bar extension cleared + its CSS var removed.
        expect(staleGuide.classList.remove).toHaveBeenCalledWith('sp-drag-guide');
        expect(staleGuide.style.removeProperty).toHaveBeenCalledWith('--sp-slot-comp');
        // ...then re-armed for THIS drag: Chrome freezes native :hover on the origin
        // folder, so the blue guide bar would stay stuck there. Marking the list
        // active lets CSS suppress that frozen :hover (the bar follows .drag-into).
        expect(listClassList.add).toHaveBeenCalledWith('sp-drag-active');
    });
});

describe('handleDragOver invalid-drop feedback', () => {
    let createContentTreeInteractions;
    let createContentDragMulti;

    function setupCtx({ state, pendingBatchKeys, groups, parentMap, items }) {
        const runtime = {};
        const groupsById = new Map();
        if (groups && typeof groups === 'object') {
            Object.keys(groups).forEach((id) => {
                const group = groups[id];
                groupsById.set(id, { id, children: [], ...group });
            });
        }
        const { sourcesListEl, shadowRoot, elementMap } = makeMockShadowList({ items });
        const tree = createContentTreeInteractions({
            runtime,
            getState: () => state,
            getGroupsById: () => groupsById,
            getPendingBatchKeys: () => pendingBatchKeys,
            getShadowRoot: () => shadowRoot,
            getParentMap: () => (parentMap || new Map()),
            isDescendant: globalThis.isDescendant,
            dragMulti: createContentDragMulti({})
        });
        return { runtime, tree, sourcesListEl, elementMap, groupsById };
    }

    beforeEach(() => {
        jest.resetModules();
        setupGlobalMocks();
        require('../../src/content/content-native-checkbox-sync.js');
        createContentTreeInteractions = require('../../src/content/content-tree-interactions.js');
        createContentDragMulti = require('../../src/content/content-drag-multi.js');
    });

    afterEach(teardownGlobalMocks);

    it('marks slot source-item invalid when dragging a single source over its own slot', () => {
        const ctx = setupCtx({
            state: { isBatchMode: false, ungrouped: ['A', 'B'], groups: [] },
            pendingBatchKeys: new Set(),
            items: [
                { kind: 'source', key: 'A', top: 100, height: 40 },
                { kind: 'source', key: 'B', top: 140, height: 40 }
            ]
        });
        ctx.runtime.activeDragContext = { kind: 'source-single', keys: ['A'] };
        const dataTransfer = { dropEffect: 'move' };
        ctx.tree.handleDragOver({
            target: { closest: () => null },
            // pointer in A's upper half → before-source A → slotKey='A' (the dragged key) → invalid
            clientY: 105,
            preventDefault: jest.fn(),
            dataTransfer
        });
        const slotEl = ctx.elementMap.get('source:A');
        expect(slotEl.classList.has('drag-invalid')).toBe(true);
        expect(dataTransfer.dropEffect).toBe('none');
    });

    it('marks group-container invalid when dragging a group over its own descendant', () => {
        const ctx = setupCtx({
            state: { isBatchMode: false, ungrouped: [], groups: ['g1'] },
            pendingBatchKeys: new Set(),
            groups: {
                g1: { id: 'g1', children: [{ type: 'group', id: 'g2' }] },
                g2: { id: 'g2', children: [] }
            },
            parentMap: new Map([['g2', 'g1']]),
            items: [
                {
                    kind: 'group', id: 'g1', top: 100, headerHeight: 30,
                    childrenStart: 130, childrenEnd: 220,
                    children: [
                        { kind: 'group', id: 'g2', top: 130, headerHeight: 30, childrenStart: 160, childrenEnd: 220 }
                    ]
                }
            ]
        });
        ctx.runtime.activeDragContext = { kind: 'group', draggedGroupId: 'g1' };
        const dataTransfer = { dropEffect: 'move' };
        ctx.tree.handleDragOver({
            target: { closest: () => null },
            // pointer in g2's header → into-group g2 → invalid (g2 is descendant of g1).
            clientY: 145,
            preventDefault: jest.fn(),
            dataTransfer
        });
        const g2El = ctx.elementMap.get('group:g2');
        expect(g2El.classList.has('drag-invalid')).toBe(true);
        expect(dataTransfer.dropEffect).toBe('none');
    });

    it('marks slot invalid when multi-source drag hovers a slot anchored to a member of the dragged set', () => {
        const ctx = setupCtx({
            state: { isBatchMode: true, ungrouped: ['A', 'B', 'C'], groups: [] },
            pendingBatchKeys: new Set(['A', 'B', 'C']),
            items: [
                { kind: 'source', key: 'A', top: 100, height: 40 },
                { kind: 'source', key: 'B', top: 140, height: 40 },
                { kind: 'source', key: 'C', top: 180, height: 40 }
            ]
        });
        ctx.runtime.activeDragContext = { kind: 'source-multi', keys: ['A', 'B', 'C'] };
        const dataTransfer = { dropEffect: 'move' };
        ctx.tree.handleDragOver({
            target: { closest: () => null },
            // pointer in B's upper half → before-source B → slotKey='B' (in dragged set) → invalid
            clientY: 145,
            preventDefault: jest.fn(),
            dataTransfer
        });
        const slotEl = ctx.elementMap.get('source:B');
        expect(slotEl.classList.has('drag-invalid')).toBe(true);
        expect(dataTransfer.dropEffect).toBe('none');
    });

    it('marks multi-source drag between two root groups as valid (positioned in state.root, no invalid outline)', () => {
        const ctx = setupCtx({
            state: { isBatchMode: true, ungrouped: [], root: [{ type: 'group', id: 'g1' }, { type: 'group', id: 'g2' }] },
            pendingBatchKeys: new Set(['A', 'B']),
            groups: {
                g1: { id: 'g1', children: [] },
                g2: { id: 'g2', children: [] }
            },
            items: [
                { kind: 'group', id: 'g1', top: 100, headerHeight: 30, childrenStart: 130, childrenEnd: 130 },
                { kind: 'group', id: 'g2', top: 200, headerHeight: 30, childrenStart: 230, childrenEnd: 230 }
            ]
        });
        ctx.runtime.activeDragContext = { kind: 'source-multi', keys: ['A', 'B'] };
        const dataTransfer = { dropEffect: 'move' };
        ctx.tree.handleDragOver({
            target: { closest: () => null },
            clientY: 150,
            preventDefault: jest.fn(),
            dataTransfer
        });
        const g1El = ctx.elementMap.get('group:g1');
        const g2El = ctx.elementMap.get('group:g2');
        // v5: y=150 sits between root groups g1 and g2 → before-group g2 against state.root.
        // A source (single or multi) positioned between two root folders is a valid
        // state.root insert, so no red invalid outline and dropEffect stays 'move'.
        expect(g1El.classList.has('drag-invalid')).toBe(false);
        expect(g2El.classList.has('drag-invalid')).toBe(false);
        expect(dataTransfer.dropEffect).toBe('move');
    });

    it('does not mark slot invalid when single source drags over a different source slot', () => {
        const ctx = setupCtx({
            state: { isBatchMode: false, ungrouped: ['A', 'B'], groups: [] },
            pendingBatchKeys: new Set(),
            items: [
                { kind: 'source', key: 'A', top: 100, height: 40 },
                { kind: 'source', key: 'B', top: 140, height: 40 }
            ]
        });
        ctx.runtime.activeDragContext = { kind: 'source-single', keys: ['A'] };
        const dataTransfer = { dropEffect: 'move' };
        ctx.tree.handleDragOver({
            target: { closest: () => null },
            // pointer in B's upper half → before-source B → slotKey='B' (not the dragged 'A') → valid.
            clientY: 145,
            preventDefault: jest.fn(),
            dataTransfer
        });
        const slotElA = ctx.elementMap.get('source:A');
        const slotElB = ctx.elementMap.get('source:B');
        expect(slotElA.classList.has('drag-invalid')).toBe(false);
        expect(slotElB.classList.has('drag-invalid')).toBe(false);
        expect(dataTransfer.dropEffect).toBe('move');
    });
});

describe('handleDragOver physical reflow', () => {
    let createContentTreeInteractions;
    let createContentDragMulti;

    function setupCtx({ state, pendingBatchKeys, groups, dragReflow, items }) {
        const groupsById = new Map();
        const runtime = {};
        if (groups && typeof groups === 'object') {
            Object.keys(groups).forEach((id) => {
                const group = groups[id];
                groupsById.set(id, { id, children: [], ...group });
            });
        }
        const { sourcesListEl, shadowRoot, elementMap } = makeMockShadowList({ items });
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
        return { runtime, tree, sourcesListEl, elementMap };
    }

    function makeDragReflowMock() {
        return {
            computeReflow: jest.fn(() => new Map([['B', 40]])),
            applyReflow: jest.fn(),
            clearReflow: jest.fn(),
            prepareDragSession: jest.fn(),
            foldDraggedItems: jest.fn(),
            unfoldDraggedItems: jest.fn(),
            extractInlineTranslateY: () => 0
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

    it('calls applyReflow with shifts when dragging over a source-item slot (no blue bar classes added)', () => {
        const dragReflow = makeDragReflowMock();
        const ctx = setupCtx({
            // v5: A and B are positioned root sources (direct #sources-list children), so
            // they live in state.root as object entries — not in the bottom bin.
            state: { isBatchMode: false, root: [{ type: 'source', key: 'A' }, { type: 'source', key: 'B' }], ungrouped: [] },
            pendingBatchKeys: new Set(),
            dragReflow,
            items: [
                { kind: 'source', key: 'A', top: 100, height: 40 },
                { kind: 'source', key: 'B', top: 140, height: 40 }
            ]
        });
        ctx.runtime.activeDragContext = { kind: 'source-single', keys: ['A'] };
        ctx.runtime.dragReflowSession = {
            draggedKeys: new Set(['A']),
            itemHeights: new Map([['A', 40]]),
            totalDraggedHeight: 40,
            currentIntent: null,
            shiftedItems: new Map()
        };

        // pointer y=145 — upper half of B (140..180, mid=160) → before-source B, insertIndex=1.
        ctx.tree.handleDragOver({
            target: { closest: () => null },
            clientY: 145,
            preventDefault: jest.fn(),
            dataTransfer: { dropEffect: 'move' }
        });

        expect(dragReflow.computeReflow).toHaveBeenCalledTimes(1);
        expect(dragReflow.applyReflow).toHaveBeenCalledTimes(1);
        const computeArgs = dragReflow.computeReflow.mock.calls[0][0];
        expect(computeArgs.session).toBe(ctx.runtime.dragReflowSession);
        expect(computeArgs.insertIndex).toBe(1);
        expect(computeArgs.siblingKeys).toEqual(['A', 'B']);
        expect(computeArgs.rootElement).toBe(ctx.sourcesListEl);
        const applyArgs = dragReflow.applyReflow.mock.calls[0][0];
        expect(applyArgs.session).toBe(ctx.runtime.dragReflowSession);
        expect(applyArgs.shifts).toBeInstanceOf(Map);
        expect(applyArgs.rootElement).toBe(ctx.sourcesListEl);

        // No blue-bar classes should ever be added to the slot element
        const slotElB = ctx.elementMap.get('source:B');
        expect(slotElB.classList.has('drag-over-top')).toBe(false);
        expect(slotElB.classList.has('drag-over-bottom')).toBe(false);
    });

    it('updates session.currentIntent with intent kind on dragover', () => {
        const dragReflow = makeDragReflowMock();
        const ctx = setupCtx({
            state: { isBatchMode: false, ungrouped: ['A', 'B'], groups: [] },
            pendingBatchKeys: new Set(),
            dragReflow,
            items: [
                { kind: 'source', key: 'A', top: 100, height: 40 },
                { kind: 'source', key: 'B', top: 140, height: 40 }
            ]
        });
        ctx.runtime.activeDragContext = { kind: 'source-single', keys: ['A'] };
        ctx.runtime.dragReflowSession = {
            draggedKeys: new Set(['A']),
            itemHeights: new Map([['A', 40]]),
            totalDraggedHeight: 40,
            currentIntent: null,
            shiftedItems: new Map()
        };

        ctx.tree.handleDragOver({
            target: { closest: () => null },
            // upper half of B → before-source
            clientY: 145,
            preventDefault: jest.fn(),
            dataTransfer: { dropEffect: 'move' }
        });

        expect(ctx.runtime.dragReflowSession.currentIntent).toBeTruthy();
        expect(ctx.runtime.dragReflowSession.currentIntent.kind).toBe('before-source');
    });

    it('records after-source kind when pointer is past the last source mid-Y', () => {
        const dragReflow = makeDragReflowMock();
        const ctx = setupCtx({
            state: { isBatchMode: false, ungrouped: ['A', 'B'], groups: [] },
            pendingBatchKeys: new Set(),
            dragReflow,
            items: [
                { kind: 'source', key: 'A', top: 100, height: 40 },
                { kind: 'source', key: 'B', top: 140, height: 40 }
            ]
        });
        ctx.runtime.activeDragContext = { kind: 'source-single', keys: ['A'] };
        ctx.runtime.dragReflowSession = {
            draggedKeys: new Set(['A']),
            itemHeights: new Map([['A', 40]]),
            totalDraggedHeight: 40,
            currentIntent: null,
            shiftedItems: new Map()
        };

        // Lower half of B (mid=160) → past B's mid → after-source B.
        ctx.tree.handleDragOver({
            target: { closest: () => null },
            clientY: 175,
            preventDefault: jest.fn(),
            dataTransfer: { dropEffect: 'move' }
        });

        expect(ctx.runtime.dragReflowSession.currentIntent.kind).toBe('after-source');
    });

    it('records into-group kind and adds drag-into class when pointer is on group-header band', () => {
        const dragReflow = makeDragReflowMock();
        const ctx = setupCtx({
            state: { isBatchMode: false, ungrouped: [], groups: ['g1'] },
            pendingBatchKeys: new Set(),
            groups: { g1: { id: 'g1', children: [] } },
            dragReflow,
            items: [{ kind: 'group', id: 'g1', top: 100, headerHeight: 40, childrenStart: 140, childrenEnd: 140 }]
        });
        ctx.runtime.activeDragContext = { kind: 'source-single', keys: ['A'] };
        ctx.runtime.dragReflowSession = {
            draggedKeys: new Set(['A']),
            itemHeights: new Map([['A', 40]]),
            totalDraggedHeight: 40,
            currentIntent: null,
            shiftedItems: new Map()
        };

        // Middle of g1's header (100..140, mid=120) → into-group.
        ctx.tree.handleDragOver({
            target: { closest: () => null },
            clientY: 120,
            preventDefault: jest.fn(),
            dataTransfer: { dropEffect: 'move' }
        });

        const g1El = ctx.elementMap.get('group:g1');
        expect(g1El.classList.has('drag-into')).toBe(true);
        expect(g1El.classList.has('drag-over-top')).toBe(false);
        expect(g1El.classList.has('drag-over-bottom')).toBe(false);
        expect(ctx.runtime.dragReflowSession.currentIntent.kind).toBe('into-group');
    });

    it('skips reflow when dragReflow dep is missing', () => {
        const ctx = setupCtx({
            state: { isBatchMode: false, ungrouped: ['A', 'B'], groups: [] },
            pendingBatchKeys: new Set(),
            dragReflow: null,
            items: [
                { kind: 'source', key: 'A', top: 100, height: 40 },
                { kind: 'source', key: 'B', top: 140, height: 40 }
            ]
        });
        ctx.runtime.activeDragContext = { kind: 'source-single', keys: ['A'] };

        expect(() => ctx.tree.handleDragOver({
            target: { closest: () => null },
            clientY: 145,
            preventDefault: jest.fn(),
            dataTransfer: { dropEffect: 'move' }
        })).not.toThrow();
        const slotElB = ctx.elementMap.get('source:B');
        expect(slotElB.classList.has('drag-over-top')).toBe(false);
        expect(slotElB.classList.has('drag-over-bottom')).toBe(false);
    });
});

describe('handleDragOver rAF coalescing', () => {
    // dragover fires above 60Hz on some pointers; the handler defers the heavy
    // path (computeDropIntent + reflow + auto-scroll) into a single per-frame
    // batch. preventDefault must stay synchronous so the browser still treats
    // the drop as accepted.
    let createContentTreeInteractions;
    let createContentDragMulti;
    let pendingRafCallbacks;
    let originalRaf;
    let originalCancelRaf;

    function installRafMock() {
        pendingRafCallbacks = [];
        originalRaf = globalThis.requestAnimationFrame;
        originalCancelRaf = globalThis.cancelAnimationFrame;
        globalThis.requestAnimationFrame = jest.fn((cb) => {
            pendingRafCallbacks.push(cb);
            return pendingRafCallbacks.length;
        });
        globalThis.cancelAnimationFrame = jest.fn((id) => {
            if (id > 0 && id <= pendingRafCallbacks.length) {
                pendingRafCallbacks[id - 1] = null;
            }
        });
    }

    function restoreRafMock() {
        if (originalRaf === undefined) delete globalThis.requestAnimationFrame;
        else globalThis.requestAnimationFrame = originalRaf;
        if (originalCancelRaf === undefined) delete globalThis.cancelAnimationFrame;
        else globalThis.cancelAnimationFrame = originalCancelRaf;
    }

    function flushRaf() {
        const queue = pendingRafCallbacks.slice();
        pendingRafCallbacks = [];
        queue.forEach((cb) => { if (typeof cb === 'function') cb(); });
    }

    function makeDragReflowMock() {
        return {
            computeReflow: jest.fn(() => new Map()),
            applyReflow: jest.fn(),
            clearReflow: jest.fn(),
            prepareDragSession: jest.fn(),
            foldDraggedItems: jest.fn(),
            unfoldDraggedItems: jest.fn(),
            extractInlineTranslateY: () => 0
        };
    }

    function setupCtx({ dragReflow, items }) {
        // v5: the mock renders items as direct #sources-list children → positioned root
        // sources in state.root (object entries); the bottom bin stays empty.
        const state = { isBatchMode: false, root: items.map((i) => ({ type: 'source', key: i.key })), ungrouped: [] };
        const { sourcesListEl, shadowRoot, elementMap } = makeMockShadowList({ items });
        const runtime = {};
        const tree = createContentTreeInteractions({
            runtime,
            getState: () => state,
            getGroupsById: () => new Map(),
            getPendingBatchKeys: () => new Set(),
            getShadowRoot: () => shadowRoot,
            getParentMap: () => new Map(),
            isDescendant: globalThis.isDescendant,
            dragMulti: createContentDragMulti({}),
            dragReflow
        });
        runtime.activeDragContext = { kind: 'source-single', keys: [items[0].key] };
        runtime.dragReflowSession = {
            draggedKeys: new Set([items[0].key]),
            itemHeights: new Map([[items[0].key, items[0].height]]),
            totalDraggedHeight: items[0].height,
            currentIntent: null,
            shiftedItems: new Map()
        };
        return { runtime, tree, sourcesListEl, elementMap };
    }

    function makeDragOverEvent(clientY) {
        return {
            target: { closest: () => null },
            clientX: 50,
            clientY,
            preventDefault: jest.fn(),
            dataTransfer: { dropEffect: 'move' }
        };
    }

    beforeEach(() => {
        jest.resetModules();
        setupGlobalMocks();
        installRafMock();
        require('../../src/content/content-native-checkbox-sync.js');
        createContentTreeInteractions = require('../../src/content/content-tree-interactions.js');
        createContentDragMulti = require('../../src/content/content-drag-multi.js');
    });

    afterEach(() => {
        restoreRafMock();
        teardownGlobalMocks();
    });

    it('schedules a single rAF for many dragover events in the same frame', () => {
        const dragReflow = makeDragReflowMock();
        const ctx = setupCtx({
            dragReflow,
            items: [
                { kind: 'source', key: 'A', top: 100, height: 40 },
                { kind: 'source', key: 'B', top: 140, height: 40 }
            ]
        });

        for (let i = 0; i < 5; i += 1) {
            ctx.tree.handleDragOver(makeDragOverEvent(145 + i));
        }

        expect(globalThis.requestAnimationFrame).toHaveBeenCalledTimes(1);
        expect(dragReflow.computeReflow).not.toHaveBeenCalled();

        flushRaf();

        expect(dragReflow.computeReflow).toHaveBeenCalledTimes(1);
    });

    it('always calls preventDefault synchronously so the browser accepts drop', () => {
        const dragReflow = makeDragReflowMock();
        const ctx = setupCtx({
            dragReflow,
            items: [
                { kind: 'source', key: 'A', top: 100, height: 40 },
                { kind: 'source', key: 'B', top: 140, height: 40 }
            ]
        });
        const events = [makeDragOverEvent(110), makeDragOverEvent(150), makeDragOverEvent(170)];
        events.forEach((event) => ctx.tree.handleDragOver(event));
        events.forEach((event) => {
            expect(event.preventDefault).toHaveBeenCalledTimes(1);
        });
    });

    it('uses the latest snapshot when the frame flushes (not the first event)', () => {
        const dragReflow = makeDragReflowMock();
        const ctx = setupCtx({
            dragReflow,
            items: [
                { kind: 'source', key: 'A', top: 100, height: 40 },
                { kind: 'source', key: 'B', top: 140, height: 40 },
                { kind: 'source', key: 'C', top: 180, height: 40 }
            ]
        });
        ctx.tree.handleDragOver(makeDragOverEvent(110));
        ctx.tree.handleDragOver(makeDragOverEvent(150));
        ctx.tree.handleDragOver(makeDragOverEvent(170));
        flushRaf();
        // v5: A,B,C are positioned root sources. y=170 sits in the upper half of C
        // (180..220, mid 200) → before-source C → state.root index 2. The first event
        // y=110 → before-source A index 0, so insertIndex=2 proves the latest snapshot won.
        const arg = dragReflow.computeReflow.mock.calls[0][0];
        expect(arg.insertIndex).toBe(2);
    });

    it('cancels the pending rAF when clearDragFeedback runs', () => {
        const dragReflow = makeDragReflowMock();
        const ctx = setupCtx({
            dragReflow,
            items: [
                { kind: 'source', key: 'A', top: 100, height: 40 },
                { kind: 'source', key: 'B', top: 140, height: 40 }
            ]
        });
        ctx.tree.handleDragOver(makeDragOverEvent(145));
        expect(globalThis.requestAnimationFrame).toHaveBeenCalledTimes(1);
        ctx.tree.clearDragFeedback();
        expect(globalThis.cancelAnimationFrame).toHaveBeenCalledTimes(1);
        flushRaf();
        expect(dragReflow.computeReflow).not.toHaveBeenCalled();
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

describe('computeDropIntent', () => {
    let createContentTreeInteractions;

    beforeEach(() => {
        jest.resetModules();
        setupGlobalMocks();
        require('../../src/content/content-native-checkbox-sync.js');
        createContentTreeInteractions = require('../../src/content/content-tree-interactions.js');
    });

    afterEach(teardownGlobalMocks);

    function buildTree({ state, groupsById, parentMap }) {
        return createContentTreeInteractions({
            getState: () => state,
            getGroupsById: () => (groupsById || new Map()),
            getParentMap: () => (parentMap || new Map())
        });
    }

    it('returns a before-source intent when the pointer is in the upper half of a root source-item', () => {
        const state = { root: [{ type: 'source', key: 'A' }, { type: 'source', key: 'B' }], ungrouped: [] };
        const tree = buildTree({ state });
        const { sourcesListEl } = makeMockShadowList({
            items: [
                { kind: 'source', key: 'A', top: 100, height: 40 },
                { kind: 'source', key: 'B', top: 140, height: 40 }
            ]
        });

        // pointer at y=145 — upper half of B (midY=160) → before-source B at insertIndex=1
        const intent = tree.computeDropIntent({
            clientY: 145,
            rootElement: sourcesListEl,
            state,
            groupsById: new Map(),
            parentMap: new Map()
        });
        expect(intent).toBeTruthy();
        expect(intent.kind).toBe('before-source');
        expect(intent.targetList).toBe(state.root);
        expect(intent.insertIndex).toBe(1);
        expect(intent.slotKey).toBe('B');
        expect(intent.targetGroup).toBeNull();
    });

    it('returns a before-group intent when the pointer is above a root group-container slot', () => {
        const state = { root: [{ type: 'group', id: 'g1' }, { type: 'group', id: 'g2' }], ungrouped: [] };
        const groupsById = new Map([
            ['g1', { id: 'g1', children: [] }],
            ['g2', { id: 'g2', children: [] }]
        ]);
        const tree = buildTree({ state, groupsById });
        const { sourcesListEl } = makeMockShadowList({
            items: [
                // g1 header from 100..130, no children band (empty group, but we put pointer outside container)
                { kind: 'group', id: 'g1', top: 100, headerHeight: 30, childrenStart: 130, childrenEnd: 130 },
                { kind: 'group', id: 'g2', top: 200, headerHeight: 30, childrenStart: 230, childrenEnd: 230 }
            ]
        });
        // pointer at y=205 — above g2's midY=215 but g2 contains it… Actually need pointer in a gap
        // between g1 and g2 where no container encloses.
        // g1 spans 100..130, g2 spans 200..230. Pointer at y=150 falls in neither.
        const intent = tree.computeDropIntent({
            clientY: 150,
            rootElement: sourcesListEl,
            state,
            groupsById,
            parentMap: new Map()
        });
        expect(intent).toBeTruthy();
        // Slot midY scan: g1 mid=115 < 150 (skip), g2 mid=215 > 150 → before-group g2.
        expect(intent.kind).toBe('before-group');
        expect(intent.targetList).toBe(state.root);
        expect(intent.insertIndex).toBe(1); // index of g2 in state.root
        expect(intent.slotKey).toBe('g2');
        expect(intent.targetGroup).toBeNull();
    });

    it('root host returns targetList === state.root and slot index into state.root (source between two folders)', () => {
        // state.root is the unified heterogeneous root array.
        const state = {
            root: [
                { type: 'group', id: 'g1' },
                { type: 'group', id: 'g2' }
            ],
            ungrouped: []
        };
        const groupsById = new Map([
            ['g1', { id: 'g1', children: [] }],
            ['g2', { id: 'g2', children: [] }]
        ]);
        const tree = buildTree({ state, groupsById });
        const { sourcesListEl } = makeMockShadowList({
            items: [
                { kind: 'group', id: 'g1', top: 100, headerHeight: 30, childrenStart: 130, childrenEnd: 130 },
                { kind: 'group', id: 'g2', top: 200, headerHeight: 30, childrenStart: 230, childrenEnd: 230 }
            ]
        });
        // Pointer at y=170 — gap between g1 (header 100..130) and g2 (200..230): neither
        // container encloses it. Slot scan: g1 mid=115 < 170 (skip), g2 mid=215 > 170 →
        // before g2. With the unified root model the source drops BETWEEN the folders.
        const intent = tree.computeDropIntent({
            clientY: 170,
            rootElement: sourcesListEl,
            state,
            groupsById,
            parentMap: new Map(),
            activeDragContext: { kind: 'source-single', keys: ['external'] }
        });
        expect(intent).toBeTruthy();
        expect(intent.targetGroup).toBeNull();
        expect(intent.targetList).toBe(state.root);
        expect(intent.kind).toBe('before-group');
        // index of g2 in state.root
        expect(intent.insertIndex).toBe(1);
        expect(intent.slotKey).toBe('g2');
    });

    it('root host: pointer in upper half of a positioned root source returns before-source index into state.root', () => {
        const state = {
            root: [
                { type: 'source', key: 'A' },
                { type: 'group', id: 'g1' },
                { type: 'source', key: 'B' }
            ],
            ungrouped: []
        };
        const groupsById = new Map([['g1', { id: 'g1', children: [] }]]);
        const tree = buildTree({ state, groupsById });
        const { sourcesListEl } = makeMockShadowList({
            items: [
                { kind: 'source', key: 'A', top: 100, height: 40 },
                { kind: 'group', id: 'g1', top: 140, headerHeight: 30, childrenStart: 170, childrenEnd: 170 },
                { kind: 'source', key: 'B', top: 200, height: 40 }
            ]
        });
        // y=205 — upper half of B (mid 220) → before-source B. B is at index 2 in state.root.
        const intent = tree.computeDropIntent({
            clientY: 205,
            rootElement: sourcesListEl,
            state,
            groupsById,
            parentMap: new Map(),
            activeDragContext: { kind: 'source-single', keys: ['external'] }
        });
        expect(intent).toBeTruthy();
        expect(intent.targetList).toBe(state.root);
        expect(intent.kind).toBe('before-source');
        expect(intent.insertIndex).toBe(2);
        expect(intent.slotKey).toBe('B');
    });

    it('routes a drop inside a non-empty .ungrouped-section to state.ungrouped (between bin items)', () => {
        const state = { root: [{ type: 'group', id: 'g1' }], ungrouped: ['u1', 'u2'] };
        const groupsById = new Map([['g1', { id: 'g1', children: [] }]]);
        const tree = buildTree({ state, groupsById });
        const { sourcesListEl } = makeMockShadowList({
            items: [
                { kind: 'group', id: 'g1', top: 100, headerHeight: 30, childrenStart: 130, childrenEnd: 130 }
            ],
            ungroupedSection: {
                bounds: { top: 300, bottom: 400 },
                items: [
                    { key: 'u1', top: 300, height: 40 },
                    { key: 'u2', top: 340, height: 40 }
                ]
            }
        });

        // Pointer at y=345 — inside the section, upper half of u2 (midY=360) → insert before u2.
        const intent = tree.computeDropIntent({
            clientY: 345,
            rootElement: sourcesListEl,
            state,
            groupsById,
            parentMap: new Map(),
            activeDragContext: { kind: 'source-single' }
        });
        expect(intent).toBeTruthy();
        expect(intent.kind).toBe('before-source');
        expect(intent.targetList).toBe(state.ungrouped);
        expect(intent.isUngroupedBin).toBe(true);
        expect(intent.insertIndex).toBe(1); // index of u2 in state.ungrouped
        expect(intent.slotKey).toBe('u2');
        expect(intent.targetGroup).toBeNull();
    });

    it('appends to state.ungrouped when the pointer is below all bin items in the .ungrouped-section', () => {
        const state = { root: [{ type: 'group', id: 'g1' }], ungrouped: ['u1', 'u2'] };
        const groupsById = new Map([['g1', { id: 'g1', children: [] }]]);
        const tree = buildTree({ state, groupsById });
        const { sourcesListEl } = makeMockShadowList({
            items: [
                { kind: 'group', id: 'g1', top: 100, headerHeight: 30, childrenStart: 130, childrenEnd: 130 }
            ],
            ungroupedSection: {
                bounds: { top: 300, bottom: 400 },
                items: [
                    { key: 'u1', top: 300, height: 40 },
                    { key: 'u2', top: 340, height: 40 }
                ]
            }
        });

        // Pointer at y=395 — below both bin items' mids (u1=320, u2=360) but still
        // inside the section (300..400) → after-source append at end of state.ungrouped.
        const intent = tree.computeDropIntent({
            clientY: 395,
            rootElement: sourcesListEl,
            state,
            groupsById,
            parentMap: new Map(),
            activeDragContext: { kind: 'source-single' }
        });
        expect(intent).toBeTruthy();
        expect(intent.kind).toBe('after-source');
        expect(intent.targetList).toBe(state.ungrouped);
        expect(intent.isUngroupedBin).toBe(true);
        expect(intent.insertIndex).toBe(2); // append (ungrouped.length)
        expect(intent.slotKey).toBe('u2');
        expect(intent.targetGroup).toBeNull();
    });

    it('returns into-group with insertIndex=0 (top of folder) when the pointer is on a group-header band', () => {
        const state = { ungrouped: [], groups: ['g1'] };
        const groupsById = new Map([
            ['g1', { id: 'g1', children: [{ type: 'source', key: 'X' }] }]
        ]);
        const tree = buildTree({ state, groupsById });
        const { sourcesListEl } = makeMockShadowList({
            items: [{ kind: 'group', id: 'g1', top: 100, headerHeight: 30, childrenStart: 130, childrenEnd: 170 }]
        });

        // Pointer at y=115 — inside g1's header (100..130).
        const intent = tree.computeDropIntent({
            clientY: 115,
            rootElement: sourcesListEl,
            state,
            groupsById,
            parentMap: new Map()
        });
        expect(intent).toBeTruthy();
        expect(intent.kind).toBe('into-group');
        // Header drop places the source at the TOP of the folder's children so the
        // user sees it immediately when the folder is expanded (matches the user's
        // mental model of "I added this source to this folder").
        expect(intent.insertIndex).toBe(0);
        expect(intent.targetGroup).toBe(groupsById.get('g1'));
        expect(intent.targetList).toBe(groupsById.get('g1').children);
    });

    it('keeps into-group sticky within a hysteresis buffer just past a collapsed header (anti-jitter)', () => {
        const state = { ungrouped: [], groups: ['g1'] };
        const groupsById = new Map([
            ['g1', { id: 'g1', collapsed: true, children: [{ type: 'source', key: 'X' }] }]
        ]);
        const tree = buildTree({ state, groupsById });
        const { sourcesListEl } = makeMockShadowList({
            // collapsed: header 100..130, no children band (childrenEnd === childrenStart),
            // so the container rect is the header strip only.
            items: [{ kind: 'group', id: 'g1', top: 100, headerHeight: 30, childrenStart: 130, childrenEnd: 130 }]
        });

        // Pointer at y=135 — 5px BELOW the header bottom (130). Without a prior
        // into-group intent the precise band excludes it → NOT into-group.
        const fresh = tree.computeDropIntent({
            clientY: 135, rootElement: sourcesListEl, state, groupsById, parentMap: new Map()
        });
        expect(fresh.kind).not.toBe('into-group');

        // With last frame already inside g1, hysteresis keeps it into-group despite the
        // small overshoot, so tiny cursor jitter at the edge doesn't flip the intent.
        const sticky = tree.computeDropIntent({
            clientY: 135, rootElement: sourcesListEl, state, groupsById, parentMap: new Map(),
            prevIntent: { kind: 'into-group', targetGroupId: 'g1' }
        });
        expect(sticky.kind).toBe('into-group');
        expect(sticky.targetGroup).toBe(groupsById.get('g1'));
    });

    it('routes to the deepest group when nested groups both contain the pointer', () => {
        const state = { ungrouped: [], groups: ['outer'] };
        const groupsById = new Map([
            ['outer', { id: 'outer', children: [{ type: 'group', id: 'inner' }] }],
            ['inner', { id: 'inner', children: [{ type: 'source', key: 'X' }] }]
        ]);
        const parentMap = new Map([['inner', 'outer']]);
        const tree = buildTree({ state, groupsById, parentMap });
        const { sourcesListEl } = makeMockShadowList({
            items: [
                {
                    kind: 'group', id: 'outer', top: 100, headerHeight: 30,
                    childrenStart: 130, childrenEnd: 260,
                    children: [
                        {
                            kind: 'group', id: 'inner', top: 130, headerHeight: 30,
                            childrenStart: 160, childrenEnd: 220,
                            children: [{ kind: 'source', key: 'X', top: 160, height: 40 }]
                        }
                    ]
                }
            ]
        });

        // pointer at y=170 — inside inner's children-area (160..220), source X at 160..200.
        // Should resolve to host = inner.children, not outer's children band.
        const intent = tree.computeDropIntent({
            clientY: 175,
            rootElement: sourcesListEl,
            state,
            groupsById,
            parentMap
        });
        expect(intent).toBeTruthy();
        // X midY = 180, pointer at 175 → before-source X.
        expect(intent.kind).toBe('before-source');
        expect(intent.targetGroup).toBe(groupsById.get('inner'));
        expect(intent.targetList).toBe(groupsById.get('inner').children);
        expect(intent.insertIndex).toBe(0);
        expect(intent.slotKey).toBe('X');
    });

    // Regression: dragging a SOURCE into a nested subfolder must not "twitch" between
    // into-group and slot. The driver is that a nested subfolder S's .group-container
    // carries a reflow translateY whenever a slot lands at/before S in its PARENT's
    // children. The header/children band reads must subtract that ANCESTOR shift to
    // recover S's true layout band, otherwise a cursor that is genuinely PAST S's header
    // (in S's children) is mis-read as into-group for the frame S still rides the shift.
    // Scene (LAYOUT coords): P > [A, S(+40 stale shift), B]; S > [s1, s2].
    //   S layout: container 170..280, header 170..200, children 200..280 (s1 200..240, s2 240..280)
    //   S rendered (+40): container 210..320, header 210..240, children 240..320 (s1 240..280, s2 280..320)
    function nestedSubfolderScene(sShift) {
        const state = { ungrouped: [], groups: ['P'] };
        const groupsById = new Map([
            ['P', { id: 'P', children: [
                { type: 'source', key: 'A' },
                { type: 'group', id: 'S' },
                { type: 'source', key: 'B' }
            ] }],
            ['S', { id: 'S', children: [
                { type: 'source', key: 's1' },
                { type: 'source', key: 's2' }
            ] }]
        ]);
        const parentMap = new Map([['S', 'P']]);
        const tree = buildTree({ state, groupsById, parentMap });
        const { sourcesListEl } = makeMockShadowList({
            items: [{
                kind: 'group', id: 'P', top: 100, headerHeight: 30, childrenStart: 130, childrenEnd: 320,
                children: [
                    { kind: 'source', key: 'A', top: 130, height: 40 },
                    {
                        kind: 'group', id: 'S', top: 170, headerHeight: 30, childrenStart: 200, childrenEnd: 280,
                        transform: sShift ? 'translateY(40px)' : undefined,
                        children: [
                            { kind: 'source', key: 's1', top: 200, height: 40 },
                            { kind: 'source', key: 's2', top: 240, height: 40 }
                        ]
                    },
                    { kind: 'source', key: 'B', top: 280, height: 40 }
                ]
            }]
        });
        return { tree, state, groupsById, parentMap, sourcesListEl };
    }

    it('does NOT misfire into-group when a nested subfolder rides a stale reflow shift (ancestor-transform aware)', () => {
        const { tree, state, groupsById, parentMap, sourcesListEl } = nestedSubfolderScene(true);
        // cursorY=215 is PAST S's true header (170..200) and inside S's true children band
        // (200..280) → the correct answer is a slot inside S (before s1). The stale +40 drags
        // S's header band down to 210..240, catching 215 → pre-fix returns into-group (the twitch).
        const intent = tree.computeDropIntent({
            clientY: 215,
            rootElement: sourcesListEl,
            state, groupsById, parentMap,
            activeDragContext: { kind: 'source-single' }
        });
        expect(intent).toBeTruthy();
        expect(intent.kind).toBe('before-source');
        expect(intent.slotKey).toBe('s1');
        expect(intent.targetGroup).toBe(groupsById.get('S'));
    });

    it('resolves the SAME slot inside a nested subfolder whether or not it rides a reflow shift (transform-invariant)', () => {
        // Identical geometry, S NOT shifted — proves the scene resolves to before-source s1
        // at the true layout band, so the shifted case above must match (no twitch).
        const { tree, state, groupsById, parentMap, sourcesListEl } = nestedSubfolderScene(false);
        const intent = tree.computeDropIntent({
            clientY: 215,
            rootElement: sourcesListEl,
            state, groupsById, parentMap,
            activeDragContext: { kind: 'source-single' }
        });
        expect(intent).toBeTruthy();
        expect(intent.kind).toBe('before-source');
        expect(intent.slotKey).toBe('s1');
    });

    it('still nests into a shifted nested subfolder when the cursor is on its TRUE header band', () => {
        // Guard against over-correction: a cursor genuinely on S's layout header (170..200)
        // must still resolve into-group even while S rides a +40 shift.
        const { tree, state, groupsById, parentMap, sourcesListEl } = nestedSubfolderScene(true);
        const intent = tree.computeDropIntent({
            clientY: 185,
            rootElement: sourcesListEl,
            state, groupsById, parentMap,
            activeDragContext: { kind: 'source-single' }
        });
        expect(intent).toBeTruthy();
        expect(intent.kind).toBe('into-group');
        expect(intent.targetGroup).toBe(groupsById.get('S'));
    });

    it('returns into-group when pointer is in an empty group children-area', () => {
        const state = { ungrouped: [], groups: ['g1'] };
        const groupsById = new Map([['g1', { id: 'g1', children: [] }]]);
        const tree = buildTree({ state, groupsById });
        const { sourcesListEl } = makeMockShadowList({
            items: [{ kind: 'group', id: 'g1', top: 100, headerHeight: 30, childrenStart: 130, childrenEnd: 200 }]
        });
        const intent = tree.computeDropIntent({
            clientY: 160,
            rootElement: sourcesListEl,
            state,
            groupsById,
            parentMap: new Map()
        });
        expect(intent).toBeTruthy();
        expect(intent.kind).toBe('into-group');
        // Empty children area = only one valid drop position, but kept at 0 for
        // consistency with header-drop semantics (handleDrop splices at this index).
        expect(intent.insertIndex).toBe(0);
        expect(intent.targetGroup).toBe(groupsById.get('g1'));
        expect(intent.hostGroupContainerEl).toBeTruthy();
    });

    it('uses visual mid-Y so a shifted sibling avoids upward when cursor enters its visual zone', () => {
        const state = { root: [{ type: 'source', key: 'A' }, { type: 'source', key: 'B' }], ungrouped: [] };
        const tree = buildTree({ state });
        // B has been translateY'd +40 to "open" a slot above it. Its visual band is now
        // 180..220 (visual mid 200); its un-shifted layout band is 140..180 (layout mid 160).
        // Cursor at 170 falls BETWEEN un-shifted mid (160) and visual mid (200) — i.e.,
        // visually it sits inside B's upper half. Slot detection should resolve to
        // before-source B (insert above B), so that on the next frame B keeps its shift
        // and the slot above it stays open — matching what the user sees.
        //
        // (Under the previous un-shifted-mid behavior, cursor 170 > layout mid 160 would
        // have resolved to after-source B and immediately collapsed the slot, forcing the
        // user to push the cursor much further upward — past 160 — before re-triggering
        // the shift. That asymmetry between up- and down-avoidance is now fixed.)
        const { sourcesListEl } = makeMockShadowList({
            // Author B in LAYOUT coords (140..180) + its own translateY(40px); the mock now
            // renders it at 180..220 (visual) exactly as the comment describes.
            items: [
                { kind: 'source', key: 'A', top: 100, height: 40 },
                { kind: 'source', key: 'B', top: 140, height: 40, transform: 'translateY(40px)' }
            ]
        });
        const intent = tree.computeDropIntent({
            clientY: 170,
            rootElement: sourcesListEl,
            state,
            groupsById: new Map(),
            parentMap: new Map()
        });
        expect(intent).toBeTruthy();
        expect(intent.kind).toBe('before-source');
        expect(intent.slotKey).toBe('B');
    });

    // P1+P2: pointer outside the sources-list viewport must return null so the caller bails.
    it('returns null when the pointer is outside the sources-list viewport', () => {
        const state = { ungrouped: ['A'], groups: [] };
        const tree = buildTree({ state });
        const { sourcesListEl } = makeMockShadowList({
            items: [{ kind: 'source', key: 'A', top: 100, height: 40 }]
        });
        // Force the list's own rect so we can probe above + below it.
        sourcesListEl.getBoundingClientRect = () => ({ top: 50, bottom: 300, height: 250, left: 0, right: 400, width: 400 });

        const aboveIntent = tree.computeDropIntent({
            clientY: 10, // far above list top (50)
            rootElement: sourcesListEl,
            state, groupsById: new Map(), parentMap: new Map()
        });
        expect(aboveIntent).toBeNull();

        const belowIntent = tree.computeDropIntent({
            clientY: 500, // far below list bottom (300)
            rootElement: sourcesListEl,
            state, groupsById: new Map(), parentMap: new Map()
        });
        expect(belowIntent).toBeNull();
    });

    // X-split corridor only fires on COLLAPSED folders. Cursor in a collapsed
    // header's left half excludes the folder from chosenContainer → root-level
    // slot detection takes over.
    it('X-split corridor fires on a COLLAPSED folder — cursor in header left half excludes the folder', () => {
        // v5: A is a positioned root source and F a root folder; the bin is empty.
        const state = { root: [{ type: 'source', key: 'A' }, { type: 'group', id: 'F' }], ungrouped: [] };
        const groupsById = new Map([
            ['F', { id: 'F', collapsed: true, children: [{ type: 'source', key: 'X' }] }]
        ]);
        const tree = buildTree({ state, groupsById });
        // Collapsed F: header only (childrenStart === childrenEnd, no children area).
        const { sourcesListEl } = makeMockShadowList({
            items: [
                { kind: 'source', key: 'A', top: 50, height: 40 },
                { kind: 'group', id: 'F', top: 100, headerHeight: 30, childrenStart: 130, childrenEnd: 130 }
            ]
        });

        // Cursor at (50, 115): clientX=50 LEFT of header midX=100; clientY=115
        // IN F header Y range (100..130). F is collapsed → X-split fires →
        // F excluded → no chosenContainer → root-level slot detection. The cursor sits
        // below every root entry's mid-Y and the bin is empty, so a source drag here
        // resolves to the empty-bin-trailing intent (targetList === state.ungrouped).
        const intent = tree.computeDropIntent({
            clientX: 50,
            clientY: 115,
            rootElement: sourcesListEl,
            state,
            groupsById,
            parentMap: new Map(),
            activeDragContext: { kind: 'source-single', keys: ['external'] }
        });
        expect(intent).toBeTruthy();
        expect(intent.targetGroup).toBeNull();
        expect(intent.targetList).toBe(state.ungrouped);
    });

    // Inverse: X-split corridor does NOT fire on an EXPANDED folder. User has
    // visual access to the children; the natural escape gesture is Y-axis gaps.
    // Cursor on an expanded folder's header (even in left half) resolves to
    // into-group as usual — header drop adds the source to the folder.
    it('X-split corridor does NOT fire on an EXPANDED folder — cursor in header left half still resolves into-group', () => {
        const state = { ungrouped: [], groups: ['F'] };
        const groupsById = new Map([
            // Expanded by default (no collapsed field).
            ['F', { id: 'F', children: [{ type: 'source', key: 'X' }] }]
        ]);
        const tree = buildTree({ state, groupsById });
        const { sourcesListEl } = makeMockShadowList({
            items: [
                {
                    kind: 'group', id: 'F', top: 100, headerHeight: 30,
                    childrenStart: 130, childrenEnd: 200,
                    children: [{ kind: 'source', key: 'X', top: 130, height: 40 }]
                }
            ]
        });

        // Cursor at (50, 115): clientX=50 LEFT of header midX=100; clientY=115
        // IN F header Y range (100..130). F is EXPANDED → X-split does NOT fire →
        // F chosen → header rect check → into-group.
        const intent = tree.computeDropIntent({
            clientX: 50,
            clientY: 115,
            rootElement: sourcesListEl,
            state,
            groupsById,
            parentMap: new Map(),
            activeDragContext: { kind: 'source-single', keys: ['external'] }
        });
        expect(intent).toBeTruthy();
        expect(intent.kind).toBe('into-group');
        expect(intent.targetGroup).toBe(groupsById.get('F'));
    });

    // X-split corridor is restricted to the header strip's Y range. Cursor over a
    // child source INSIDE an expanded folder must not get excluded — and since
    // X-split doesn't fire on expanded folders anyway, this is doubly safe.
    // Without this rule the dragged source would inexplicably escape to root
    // level just because cursor X happened to land in the folder's left half
    // while hovering over an existing child.
    it('X-split applies only to the header Y range — cursor over a child inside the folder uses inside-folder slot detection regardless of X', () => {
        const state = { ungrouped: [], groups: ['F'] };
        const groupsById = new Map([
            ['F', { id: 'F', children: [{ type: 'source', key: 'X' }] }]
        ]);
        const tree = buildTree({ state, groupsById });
        // F: container 100..200, header 100..130, children 130..200. Width 200, midX=100.
        // X (only child): top=130, height=40 → rect 130..170, visual midY=150.
        const { sourcesListEl } = makeMockShadowList({
            items: [
                {
                    kind: 'group', id: 'F', top: 100, headerHeight: 30,
                    childrenStart: 130, childrenEnd: 200,
                    children: [{ kind: 'source', key: 'X', top: 130, height: 40 }]
                }
            ]
        });

        // Cursor at (50, 145): clientX=50 is LEFT of header midX (100); clientY=145
        // is in children area (130..200), NOT in header (100..130).
        // Old behavior (X-split on full container): F's container Y range contains
        // cursor + clientX<midX → F excluded → root-level slot → would not return X.
        // New behavior (X-split on header only): cursor Y outside header → F NOT
        // excluded → F chosen → host = F.children → slot detection → X midY=150 >
        // clientY=145 → before-source X.
        const intent = tree.computeDropIntent({
            clientX: 50,
            clientY: 145,
            rootElement: sourcesListEl,
            state,
            groupsById,
            parentMap: new Map(),
            activeDragContext: { kind: 'source-single', keys: ['external'] }
        });
        expect(intent).toBeTruthy();
        expect(intent.kind).toBe('before-source');
        expect(intent.targetGroup).toBe(groupsById.get('F'));
        expect(intent.targetList).toBe(groupsById.get('F').children);
        expect(intent.slotKey).toBe('X');
    });

    it('returns an ungrouped trailing intent when the bin is empty and the cursor is below all root content', () => {
        // state.root holds one positioned source A; the bottom bin (state.ungrouped) is empty.
        const state = { ungrouped: [], root: [{ type: 'source', key: 'A' }] };
        const tree = buildTree({ state });
        const { sourcesListEl } = makeMockShadowList({
            // A renders 100..140; the list viewport extends to bottom:1000 so there is a
            // large trailing empty band below A.
            items: [{ kind: 'source', key: 'A', top: 100, height: 40 }],
            listRect: { top: 0, bottom: 1000, height: 1000 }
        });

        // Cursor at y=400 — well below A's bottom (140), inside the trailing band.
        const intent = tree.computeDropIntent({
            clientX: 100,
            clientY: 400,
            rootElement: sourcesListEl,
            state,
            groupsById: new Map(),
            parentMap: new Map(),
            activeDragContext: { kind: 'source-single' }
        });
        expect(intent).toBeTruthy();
        expect(intent.kind).toBe('after-source');
        expect(intent.targetList).toBe(state.ungrouped);
        expect(intent.insertIndex).toBe(0);
        expect(intent.targetGroup).toBeNull();
        expect(intent.hostGroupContainerEl).toBeNull();
        // Flag for the dropzone-rendering path so _processDragOver knows to mount the hint.
        expect(intent.isEmptyBinTrailing).toBe(true);
    });

    it('does NOT return the empty-bin trailing intent when the bin already has sources', () => {
        const state = { ungrouped: ['Z'], root: [{ type: 'source', key: 'A' }] };
        const tree = buildTree({ state });
        const { sourcesListEl } = makeMockShadowList({
            items: [
                { kind: 'source', key: 'A', top: 100, height: 40 },
                // Z is a bin source; in the real DOM it lives inside .ungrouped-section and is
                // NOT a :scope> child, so the mock omits it from root children — matching
                // computeDropIntent's candidate scan. The bin being non-empty is read from state.
                { kind: 'source', key: 'A2', top: 140, height: 40 }
            ]
        });
        const intent = tree.computeDropIntent({
            clientX: 100,
            clientY: 400,
            rootElement: sourcesListEl,
            state: { ungrouped: ['Z'], root: [{ type: 'source', key: 'A' }, { type: 'source', key: 'A2' }] },
            groupsById: new Map(),
            parentMap: new Map(),
            activeDragContext: { kind: 'source-single' }
        });
        expect(intent).toBeTruthy();
        expect(intent.isEmptyBinTrailing).toBeUndefined();
    });
});

describe('handleDragOver hover-expand', () => {
    let createContentTreeInteractions;
    let createContentDragMulti;

    function setupTreeInteractionsTestContext({ state, pendingBatchKeys, groups, parentMap, items }) {
        const groupsById = new Map();
        const runtime = { groupsById };
        if (groups && typeof groups === 'object') {
            Object.keys(groups).forEach((id) => {
                const group = groups[id];
                groupsById.set(id, { id, children: [], ...group });
            });
        }
        const resolvedParentMap = parentMap instanceof Map ? parentMap : new Map();
        const { sourcesListEl, elementMap } = makeMockShadowList({ items: items || [] });

        // Augment shadowRoot.querySelector to also resolve `.group-container[data-group-id="..."]`
        // (used by executeHoverExpand/executeHoverCollapse to find the container DOM).
        const shadowRoot = {
            getElementById: (id) => (id === 'sources-list' ? sourcesListEl : null),
            querySelector: (selector) => {
                const m = /^\.group-container\[data-group-id="([^"]+)"\]$/.exec(selector);
                if (m) return elementMap.get('group:' + m[1]) || null;
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

        // Compatibility shim: dragOverFor(groupId) sends a synthetic dragover whose pointer
        // lands inside the group's header band → into-group intent (matches the old behavior
        // where target was the group-container).
        function dragOverFor(groupId, clientYOverride) {
            const el = elementMap.get('group:' + groupId);
            const r = el ? el.rect : { top: 0, height: 40 };
            const headerEl = el && typeof el.querySelector === 'function' ? el.querySelector('.group-header') : null;
            const headerRect = headerEl ? headerEl.rect : r;
            const clientY = typeof clientYOverride === 'number'
                ? clientYOverride
                : headerRect.top + headerRect.height / 2;
            tree.handleDragOver({
                target: { closest: () => null },
                clientY,
                preventDefault: jest.fn(),
                dataTransfer: { dropEffect: 'move' }
            });
        }

        function makeDropEvent({ data, sourceKey }) {
            return {
                target: { closest: () => null },
                preventDefault: jest.fn(),
                clientY: 0,
                dataTransfer: {
                    getData: (key) => (data && Object.prototype.hasOwnProperty.call(data, key) ? data[key] : ''),
                    dropEffect: 'move'
                }
            };
        }

        return {
            runtime,
            tree,
            helpers: { dragOverFor, makeDropEvent },
            groupsById,
            elementMap
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

    it('marks the pointer-over folder children with sp-drag-guide + --sp-slot-comp during drag', () => {
        const ctx = setupTreeInteractionsTestContext({
            state: { isBatchMode: false, ungrouped: [], groups: ['g1'] },
            pendingBatchKeys: new Set(),
            groups: { g1: { id: 'g1', children: [{ type: 'source', key: 'X' }], collapsed: false } },
            items: [{ kind: 'group', id: 'g1', top: 100, headerHeight: 40, childrenStart: 140, childrenEnd: 200 }]
        });
        // Active drag with a known slot height (the dragged row's height).
        ctx.runtime.dragReflowSession = {
            draggedKeys: new Set(['Y']), itemHeights: new Map(),
            totalDraggedHeight: 48, shiftedItems: new Map(), currentIntent: null
        };

        ctx.helpers.dragOverFor('g1'); // pointer in g1's header → into-group g1

        // The folder the pointer is over gets a blue guide that extends by one slot
        // (preview of where the dragged source lands, incl. an empty slot at the end).
        const childrenEl = ctx.elementMap.get('group:g1').querySelector('.group-children');
        expect(childrenEl.classList.contains('sp-drag-guide')).toBe(true);
        expect(childrenEl.style.setProperty).toHaveBeenCalledWith('--sp-slot-comp', '48px');
    });

    // Dead-zone regression: dragging a SOURCE up over a COLLAPSED folder's header LEFT
    // half (or into the gap) routes to a root-level reorder. When state.ungrouped is
    // empty (everything is filed into folders) that falls through routeToNearestNeighborKind's
    // empty-list branch → { hostGroupContainerEl: null, slotKey: null }, which silently
    // disables ALL feedback: no header cue, no blue guide, no hover-expand. The folder the
    // cursor is physically over must still arm hover-expand (and show its pending cue)
    // regardless of where the drop intent resolves — a dwell then opens it so the user can
    // drop inside. We use the honest .sp-hover-expand-pending cue (NOT .drag-into, which
    // would falsely imply the drop lands inside while the X-split escape routes to ungrouped).
    it('source drag over a COLLAPSED folder header (left half, empty ungrouped) still shows the hover-expand pending cue on that folder', () => {
        const ctx = setupTreeInteractionsTestContext({
            state: { isBatchMode: false, ungrouped: [], groups: ['g1'] },
            pendingBatchKeys: new Set(),
            groups: { g1: { id: 'g1', children: [{ type: 'source', key: 'X' }], collapsed: true } },
            items: [{ kind: 'group', id: 'g1', top: 100, headerHeight: 40, childrenStart: 140, childrenEnd: 140 }]
        });
        ctx.runtime.activeDragContext = { kind: 'source-single' };
        ctx.runtime.dragReflowSession = {
            draggedKeys: new Set(['Y']), itemHeights: new Map(),
            totalDraggedHeight: 48, shiftedItems: new Map(), currentIntent: null
        };
        // clientX=10 → left half of the 0..200 header → X-split excludes g1 → root reorder.
        // clientY=120 → inside g1's collapsed header band (100..140).
        ctx.tree.handleDragOver({
            target: { closest: () => null },
            clientX: 10, clientY: 120,
            preventDefault: jest.fn(),
            dataTransfer: { dropEffect: 'move' }
        });
        expect(ctx.elementMap.get('group:g1').classList.contains('sp-hover-expand-pending')).toBe(true);
    });

    it('source drag dwelling on a COLLAPSED folder header (left half, empty ungrouped) arms hover-expand and opens it after 1000ms', () => {
        const ctx = setupTreeInteractionsTestContext({
            state: { isBatchMode: false, ungrouped: [], groups: ['g1'] },
            pendingBatchKeys: new Set(),
            groups: { g1: { id: 'g1', children: [{ type: 'source', key: 'X' }], collapsed: true } },
            items: [{ kind: 'group', id: 'g1', top: 100, headerHeight: 40, childrenStart: 140, childrenEnd: 140 }]
        });
        ctx.runtime.activeDragContext = { kind: 'source-single' };
        ctx.runtime.dragReflowSession = {
            draggedKeys: new Set(['Y']), itemHeights: new Map(),
            totalDraggedHeight: 48, shiftedItems: new Map(), currentIntent: null
        };
        ctx.tree.handleDragOver({
            target: { closest: () => null },
            clientX: 10, clientY: 120,
            preventDefault: jest.fn(),
            dataTransfer: { dropEffect: 'move' }
        });
        jest.advanceTimersByTime(1000);
        expect(ctx.groupsById.get('g1').collapsed).toBe(false);
    });

    it('expands a collapsed group after 1000ms of continuous hover', () => {
        const ctx = setupTreeInteractionsTestContext({
            state: { isBatchMode: false, ungrouped: [], groups: ['g1'] },
            pendingBatchKeys: new Set(),
            groups: { g1: { id: 'g1', children: [{ type: 'source', key: 'X' }], collapsed: true } },
            items: [{ kind: 'group', id: 'g1', top: 100, headerHeight: 40, childrenStart: 140, childrenEnd: 140 }]
        });
        ctx.helpers.dragOverFor('g1');
        jest.advanceTimersByTime(1000);
        expect(ctx.groupsById.get('g1').collapsed).toBe(false);
    });

    it('cancels the timer when the drop target changes before 1000ms', () => {
        const ctx = setupTreeInteractionsTestContext({
            state: { isBatchMode: false, ungrouped: [], groups: ['g1', 'g2'] },
            pendingBatchKeys: new Set(),
            groups: {
                g1: { id: 'g1', children: [{ type: 'source', key: 'X' }], collapsed: true },
                g2: { id: 'g2', children: [{ type: 'source', key: 'Y' }], collapsed: true }
            },
            items: [
                { kind: 'group', id: 'g1', top: 100, headerHeight: 40, childrenStart: 140, childrenEnd: 140 },
                { kind: 'group', id: 'g2', top: 200, headerHeight: 40, childrenStart: 240, childrenEnd: 240 }
            ]
        });
        ctx.helpers.dragOverFor('g1');
        jest.advanceTimersByTime(300);
        ctx.helpers.dragOverFor('g2');
        jest.advanceTimersByTime(1000);
        expect(ctx.groupsById.get('g1').collapsed).toBe(true);
    });

    it('does not arm a timer on an already-expanded group', () => {
        const ctx = setupTreeInteractionsTestContext({
            state: { isBatchMode: false, ungrouped: [], groups: ['g1'] },
            pendingBatchKeys: new Set(),
            groups: { g1: { id: 'g1', children: [{ type: 'source', key: 'X' }], collapsed: false } },
            items: [{ kind: 'group', id: 'g1', top: 100, headerHeight: 40, childrenStart: 140, childrenEnd: 200 }]
        });
        ctx.helpers.dragOverFor('g1');
        jest.advanceTimersByTime(1000);
        expect(ctx.groupsById.get('g1').collapsed).toBe(false);
    });

    it('does not arm a timer on a collapsed but empty group', () => {
        const ctx = setupTreeInteractionsTestContext({
            state: { isBatchMode: false, ungrouped: [], groups: ['g1'] },
            pendingBatchKeys: new Set(),
            groups: { g1: { id: 'g1', children: [], collapsed: true } },
            items: [{ kind: 'group', id: 'g1', top: 100, headerHeight: 40, childrenStart: 140, childrenEnd: 140 }]
        });
        ctx.helpers.dragOverFor('g1');
        jest.advanceTimersByTime(1000);
        expect(ctx.groupsById.get('g1').collapsed).toBe(true);
    });

    it('cancels the timer on dragleave from #sources-list', () => {
        const ctx = setupTreeInteractionsTestContext({
            state: { isBatchMode: false, ungrouped: [], groups: ['g1'] },
            pendingBatchKeys: new Set(),
            groups: { g1: { id: 'g1', children: [{ type: 'source', key: 'X' }], collapsed: true } },
            items: [{ kind: 'group', id: 'g1', top: 100, headerHeight: 40, childrenStart: 140, childrenEnd: 140 }]
        });
        ctx.helpers.dragOverFor('g1');
        jest.advanceTimersByTime(300);
        ctx.tree.handleDragLeave({ target: { id: 'sources-list', closest: () => null } });
        jest.advanceTimersByTime(1000);
        expect(ctx.groupsById.get('g1').collapsed).toBe(true);
    });

    it('collapses in state when the container is unreachable mid-drag (no permanent open)', () => {
        // H4: g1 is hover-opened, then its DOM node disappears (external state
        // sync rebuilt the list mid-drag) before the collapse timer fires. The
        // old code deleted g1 from hoverExpandedGroupIds and then bailed at the
        // `if (!container) return` guard, leaving g1.collapsed === false forever
        // with nothing tracking it. executeHoverCollapse must collapse g1 in
        // state regardless, so the next render() reconciles the DOM.
        const ctx = setupTreeInteractionsTestContext({
            state: { isBatchMode: false, ungrouped: [], groups: ['g1', 'g2'] },
            pendingBatchKeys: new Set(),
            groups: {
                g1: { id: 'g1', children: [{ type: 'source', key: 'X' }], collapsed: true },
                g2: { id: 'g2', children: [{ type: 'source', key: 'Y' }], collapsed: true }
            },
            items: [
                { kind: 'group', id: 'g1', top: 100, headerHeight: 40, childrenStart: 140, childrenEnd: 180 },
                { kind: 'group', id: 'g2', top: 300, headerHeight: 40, childrenStart: 340, childrenEnd: 380 }
            ]
        });

        // Hover g1 for 1000ms → hover-expand it.
        ctx.helpers.dragOverFor('g1');
        jest.advanceTimersByTime(1000);
        expect(ctx.groupsById.get('g1').collapsed).toBe(false);
        expect(ctx.runtime.hoverExpandedGroupIds.has('g1')).toBe(true);

        // Move onto g2 → arms a collapse timer for g1 (g1 is not an ancestor of g2).
        ctx.helpers.dragOverFor('g2');
        // External sync removes g1's DOM node before the collapse timer fires.
        ctx.elementMap.delete('group:g1');

        jest.advanceTimersByTime(1000);

        // g1 must end up collapsed in state even though its container was gone.
        expect(ctx.groupsById.get('g1').collapsed).toBe(true);
    });

    it('cancels the timer on dragend', () => {
        const ctx = setupTreeInteractionsTestContext({
            state: { isBatchMode: false, ungrouped: [], groups: ['g1'] },
            pendingBatchKeys: new Set(),
            groups: { g1: { id: 'g1', children: [{ type: 'source', key: 'X' }], collapsed: true } },
            items: [{ kind: 'group', id: 'g1', top: 100, headerHeight: 40, childrenStart: 140, childrenEnd: 140 }]
        });
        ctx.helpers.dragOverFor('g1');
        jest.advanceTimersByTime(300);
        ctx.tree.handleDragEnd({ target: { closest: () => null } });
        jest.advanceTimersByTime(1000);
        expect(ctx.groupsById.get('g1').collapsed).toBe(true);
    });

    it('cancels the timer on drop', () => {
        const ctx = setupTreeInteractionsTestContext({
            state: { isBatchMode: false, ungrouped: ['A'], groups: ['g1'] },
            pendingBatchKeys: new Set(),
            groups: { g1: { id: 'g1', children: [{ type: 'source', key: 'X' }], collapsed: true } },
            items: [{ kind: 'group', id: 'g1', top: 100, headerHeight: 40, childrenStart: 140, childrenEnd: 140 }]
        });
        ctx.helpers.dragOverFor('g1');
        jest.advanceTimersByTime(300);
        ctx.tree.handleDrop(ctx.helpers.makeDropEvent({
            data: { 'application/source-key': 'A' }
        }));
        jest.advanceTimersByTime(1000);
        expect(ctx.groupsById.get('g1').collapsed).toBe(true);
    });

    // Pending-expand visual cue (.sp-hover-expand-pending): added on the host
    // group-container when the 1000ms hover timer arms, removed when the timer
    // fires (= the group actually opens) or cancels (pointer moved off, drag
    // ended, etc.). CSS turns this into a 1000ms outline build-up so the user
    // sees "this group is about to open" during the wait.
    it('adds .sp-hover-expand-pending on the group-container while the expand timer is armed', () => {
        const ctx = setupTreeInteractionsTestContext({
            state: { isBatchMode: false, ungrouped: [], groups: ['g1'] },
            pendingBatchKeys: new Set(),
            groups: { g1: { id: 'g1', children: [{ type: 'source', key: 'X' }], collapsed: true } },
            items: [{ kind: 'group', id: 'g1', top: 100, headerHeight: 40, childrenStart: 140, childrenEnd: 140 }]
        });
        ctx.helpers.dragOverFor('g1');
        const container = ctx.elementMap.get('group:g1');
        expect(container.classList.contains('sp-hover-expand-pending')).toBe(true);
    });

    it('removes .sp-hover-expand-pending when the expand timer fires (group opens)', () => {
        const ctx = setupTreeInteractionsTestContext({
            state: { isBatchMode: false, ungrouped: [], groups: ['g1'] },
            pendingBatchKeys: new Set(),
            groups: { g1: { id: 'g1', children: [{ type: 'source', key: 'X' }], collapsed: true } },
            items: [{ kind: 'group', id: 'g1', top: 100, headerHeight: 40, childrenStart: 140, childrenEnd: 140 }]
        });
        ctx.helpers.dragOverFor('g1');
        const container = ctx.elementMap.get('group:g1');
        expect(container.classList.contains('sp-hover-expand-pending')).toBe(true);
        jest.advanceTimersByTime(1000);
        expect(container.classList.contains('sp-hover-expand-pending')).toBe(false);
        expect(ctx.groupsById.get('g1').collapsed).toBe(false);
    });

    it('removes .sp-hover-expand-pending when the pointer moves to a different group before 1000ms', () => {
        const ctx = setupTreeInteractionsTestContext({
            state: { isBatchMode: false, ungrouped: [], groups: ['g1', 'g2'] },
            pendingBatchKeys: new Set(),
            groups: {
                g1: { id: 'g1', children: [{ type: 'source', key: 'X' }], collapsed: true },
                g2: { id: 'g2', children: [{ type: 'source', key: 'Y' }], collapsed: true }
            },
            items: [
                { kind: 'group', id: 'g1', top: 100, headerHeight: 40, childrenStart: 140, childrenEnd: 140 },
                { kind: 'group', id: 'g2', top: 200, headerHeight: 40, childrenStart: 240, childrenEnd: 240 }
            ]
        });
        ctx.helpers.dragOverFor('g1');
        const c1 = ctx.elementMap.get('group:g1');
        expect(c1.classList.contains('sp-hover-expand-pending')).toBe(true);
        // Pointer moves to g2 before g1's 1000ms elapsed → g1 timer cancels.
        jest.advanceTimersByTime(300);
        ctx.helpers.dragOverFor('g2');
        expect(c1.classList.contains('sp-hover-expand-pending')).toBe(false);
        const c2 = ctx.elementMap.get('group:g2');
        expect(c2.classList.contains('sp-hover-expand-pending')).toBe(true);
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
                groups: { g1: { id: 'g1', children: [{ type: 'source', key: 'X' }], collapsed: true } },
                items: [{ kind: 'group', id: 'g1', top: 100, headerHeight: 40, childrenStart: 140, childrenEnd: 140 }]
            });
            ctx.helpers.dragOverFor('g1');
            jest.advanceTimersByTime(1000);
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

        it('collapses a hover-opened group 1000ms after the pointer leaves its subtree', () => {
            const ctx = setupTreeInteractionsTestContext({
                state: { isBatchMode: false, ungrouped: [], groups: ['A', 'B'] },
                pendingBatchKeys: new Set(),
                groups: {
                    A: { id: 'A', children: [{ type: 'source', key: 'X' }], collapsed: true },
                    B: { id: 'B', children: [{ type: 'source', key: 'Y' }], collapsed: true }
                },
                items: [
                    { kind: 'group', id: 'A', top: 100, headerHeight: 40, childrenStart: 140, childrenEnd: 140 },
                    { kind: 'group', id: 'B', top: 200, headerHeight: 40, childrenStart: 240, childrenEnd: 240 }
                ]
            });

            ctx.helpers.dragOverFor('A');
            jest.advanceTimersByTime(1000);
            expect(ctx.runtime.groupsById.get('A').collapsed).toBe(false);
            expect(ctx.runtime.hoverExpandedGroupIds.has('A')).toBe(true);

            // Move pointer to a sibling B (not in A's chain).
            ctx.helpers.dragOverFor('B');

            // A should now have a pending collapse timer.
            expect(ctx.runtime.hoverExpandTimers.get('A')).toMatchObject({ kind: 'collapse' });

            // 1000ms later, A collapses.
            jest.advanceTimersByTime(1000);
            expect(ctx.runtime.groupsById.get('A').collapsed).toBe(true);
            expect(ctx.runtime.hoverExpandedGroupIds.has('A')).toBe(false);
        });

        it('cancels the collapse timer when pointer returns within 1000ms', () => {
            const ctx = setupTreeInteractionsTestContext({
                state: { isBatchMode: false, ungrouped: [], groups: ['A', 'B'] },
                pendingBatchKeys: new Set(),
                groups: {
                    A: { id: 'A', children: [{ type: 'source', key: 'X' }], collapsed: false },
                    B: { id: 'B', children: [{ type: 'source', key: 'Y' }], collapsed: false }
                },
                items: [
                    { kind: 'group', id: 'A', top: 100, headerHeight: 40, childrenStart: 140, childrenEnd: 200 },
                    { kind: 'group', id: 'B', top: 200, headerHeight: 40, childrenStart: 240, childrenEnd: 300 }
                ]
            });
            ctx.runtime.hoverExpandedGroupIds.add('A');

            // Pointer on B (not in A's chain) → arm collapse timer for A.
            ctx.helpers.dragOverFor('B');
            expect(ctx.runtime.hoverExpandTimers.get('A')).toMatchObject({ kind: 'collapse' });
            jest.advanceTimersByTime(300);

            // Pointer returns to A → cancel collapse timer.
            ctx.helpers.dragOverFor('A');
            expect(ctx.runtime.hoverExpandTimers.get('A')).toBeUndefined();

            jest.advanceTimersByTime(1000);
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
                parentMap: new Map([['B', 'A']]),
                items: [
                    {
                        kind: 'group', id: 'A', top: 100, headerHeight: 40,
                        childrenStart: 140, childrenEnd: 280,
                        children: [
                            { kind: 'group', id: 'B', top: 140, headerHeight: 40, childrenStart: 180, childrenEnd: 240 }
                        ]
                    }
                ]
            });
            ctx.runtime.hoverExpandedGroupIds.add('A');

            // Pointer enters B (descendant of A).
            ctx.helpers.dragOverFor('B');

            // A should NOT have a collapse timer.
            expect(ctx.runtime.hoverExpandTimers.get('A')).toBeUndefined();
            jest.advanceTimersByTime(1000);
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
                groups: { g1: { id: 'g1', children: [{ type: 'source', key: 'X' }], collapsed: false } },
                items: [{ kind: 'group', id: 'g1', top: 100, headerHeight: 40, childrenStart: 140, childrenEnd: 200 }]
            });
            ctx.runtime.hoverExpandedGroupIds.add('g1');
            // Pre-populate intent (mimics dragover preceding the drop).
            ctx.runtime.dragReflowSession = {
                draggedKeys: new Set(['A']),
                currentIntent: {
                    kind: 'into-group',
                    targetGroup: ctx.groupsById.get('g1'),
                    targetList: ctx.groupsById.get('g1').children,
                    insertIndex: -1,
                    targetGroupId: 'g1',
                    hostGroupContainerEl: ctx.elementMap.get('group:g1'),
                    slotKey: null
                },
                shiftedItems: new Map()
            };
            ctx.tree.handleDrop(ctx.helpers.makeDropEvent({
                data: { 'application/source-key': 'A' }
            }));

            expect(ctx.runtime.groupsById.get('g1').collapsed).toBe(false);
            expect(ctx.runtime.hoverExpandedGroupIds.has('g1')).toBe(false);
        });

        it('collapses the hover-opened group when drop lands outside its subtree', () => {
            const g2Group = { id: 'g2', children: [], collapsed: false };
            const ctx = setupTreeInteractionsTestContext({
                state: { isBatchMode: false, ungrouped: ['A'], groups: ['g1', 'g2'] },
                pendingBatchKeys: new Set(),
                groups: {
                    g1: { id: 'g1', children: [{ type: 'source', key: 'X' }], collapsed: false },
                    g2: g2Group
                },
                items: [
                    { kind: 'group', id: 'g1', top: 100, headerHeight: 40, childrenStart: 140, childrenEnd: 200 },
                    { kind: 'group', id: 'g2', top: 220, headerHeight: 40, childrenStart: 260, childrenEnd: 260 }
                ]
            });
            ctx.runtime.hoverExpandedGroupIds.add('g1');

            // Drop into g2 (sibling, not in g1's chain).
            ctx.runtime.dragReflowSession = {
                draggedKeys: new Set(['A']),
                currentIntent: {
                    kind: 'into-group',
                    targetGroup: ctx.groupsById.get('g2'),
                    targetList: ctx.groupsById.get('g2').children,
                    insertIndex: -1,
                    targetGroupId: 'g2',
                    hostGroupContainerEl: ctx.elementMap.get('group:g2'),
                    slotKey: null
                },
                shiftedItems: new Map()
            };
            ctx.tree.handleDrop(ctx.helpers.makeDropEvent({
                data: { 'application/source-key': 'A' }
            }));

            expect(ctx.runtime.groupsById.get('g1').collapsed).toBe(true);
            expect(ctx.runtime.hoverExpandedGroupIds.has('g1')).toBe(false);
        });

        it('collapses hover-opened groups on handleDragEnd if drop never landed inside', () => {
            const ctx = setupTreeInteractionsTestContext({
                state: { isBatchMode: false, ungrouped: ['A'], groups: ['g1'] },
                pendingBatchKeys: new Set(),
                groups: { g1: { id: 'g1', children: [{ type: 'source', key: 'X' }], collapsed: false } },
                items: [{ kind: 'group', id: 'g1', top: 100, headerHeight: 40, childrenStart: 140, childrenEnd: 200 }]
            });
            ctx.runtime.hoverExpandedGroupIds.add('g1');

            ctx.tree.handleDragEnd({ target: { closest: () => null } });

            expect(ctx.runtime.groupsById.get('g1').collapsed).toBe(true);
            expect(ctx.runtime.hoverExpandedGroupIds.size).toBe(0);
        });

        it('keeps an ancestor open when dropping a group above a sibling inside it', () => {
            const ctx = setupTreeInteractionsTestContext({
                state: { isBatchMode: false, ungrouped: [], root: [{ type: 'group', id: 'g1' }, { type: 'group', id: 'gD' }] },
                pendingBatchKeys: new Set(),
                groups: {
                    g1: { id: 'g1', children: [{ type: 'group', id: 'g3' }], collapsed: false },
                    g3: { id: 'g3', children: [], collapsed: false },
                    gD: { id: 'gD', children: [], collapsed: false }
                },
                parentMap: new Map([['g3', 'g1']]),
                items: [
                    {
                        kind: 'group', id: 'g1', top: 100, headerHeight: 40, childrenStart: 140, childrenEnd: 220,
                        children: [
                            { kind: 'group', id: 'g3', top: 140, headerHeight: 40, childrenStart: 180, childrenEnd: 180 }
                        ]
                    },
                    { kind: 'group', id: 'gD', top: 300, headerHeight: 40, childrenStart: 340, childrenEnd: 340 }
                ]
            });
            ctx.runtime.hoverExpandedGroupIds.add('g1');

            // Drop intent: dropping gD above g3 (inside g1). targetGroup = g1.
            ctx.runtime.dragReflowSession = {
                draggedKeys: new Set(['gD']),
                currentIntent: {
                    kind: 'before-group',
                    targetGroup: ctx.groupsById.get('g1'),
                    targetList: ctx.groupsById.get('g1').children,
                    insertIndex: 0,
                    targetGroupId: 'g1',
                    hostGroupContainerEl: ctx.elementMap.get('group:g1'),
                    slotKey: 'g3'
                },
                shiftedItems: new Map()
            };
            ctx.tree.handleDrop(ctx.helpers.makeDropEvent({
                data: { 'application/group-id': 'gD' }
            }));

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
            currentIntent: {
                kind: 'after-source',
                targetGroup: null,
                targetList: state.ungrouped,
                insertIndex: 2,
                targetGroupId: null,
                slotKey: 'source-2'
            },
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

    it('fades the landed element in with opacity only (no fly-in / scaleY direction-baggage)', () => {
        const state = { groups: [], ungrouped: ['source-1', 'source-2'] };
        const saveState = jest.fn();
        const render = jest.fn();
        // Capture every transform write so we can verify the FLIP sequence:
        //   1. translate(dx, dy) — offset from cursor to slot
        //   2. '' — cleared so the transition animates back to (0, 0)
        const transformWrites = [];
        const opacityWrites = [];
        const landedStyle = {};
        Object.defineProperty(landedStyle, 'transform', {
            get() { return this._t || ''; },
            set(v) { transformWrites.push(v); this._t = v; }
        });
        Object.defineProperty(landedStyle, 'opacity', {
            get() { return this._o || ''; },
            set(v) { opacityWrites.push(v); this._o = v; }
        });
        const landedEl = {
            classList: createClassList(['source-item']),
            addEventListener: jest.fn(),
            style: landedStyle,
            offsetHeight: 40, // read forces layout flush
            getBoundingClientRect: () => ({ left: 100, top: 200, right: 400, bottom: 240, width: 300, height: 40 })
        };
        const sourcesListEl = {
            id: 'sources-list',
            querySelector: jest.fn((selector) => {
                if (selector === '[data-source-key="source-1"]') return landedEl;
                return null;
            })
        };
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
            currentIntent: {
                kind: 'after-source',
                targetGroup: null,
                targetList: state.ungrouped,
                insertIndex: 2,
                targetGroupId: null,
                slotKey: 'source-2'
            },
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

        // Cursor dropped at (160, 220) — element rect is (100, 200) so offset = (60, 20).
        const dropEvent = createDropEvent({ dropTarget, sourceKey: 'source-1' });
        dropEvent.clientX = 160;
        dropEvent.clientY = 220;
        interactions.handleDrop(dropEvent);

        // Drop landing uses a direction-neutral opacity 0 → 1 fade-in. No fly-in /
        // scaleY classes (which previously carried a visible "from the right" or
        // "growing from top" feel the user rejected). Transform stays untouched so
        // the post-drop pseudo-hover scale(1.01) can still apply via CSS.
        expect(landedEl.classList.add).not.toHaveBeenCalledWith('sp-drop-flying');
        expect(landedEl.classList.add).not.toHaveBeenCalledWith('sp-drop-landed');
        expect(landedEl.classList.add).not.toHaveBeenCalledWith('sp-drop-landing');
        expect(transformWrites).toEqual([]);
        // Sequence: jump to 0 (instant, transition still 'none' from suppression),
        // force layout flush, switch transition to opacity 180ms, target ''.
        expect(opacityWrites).toEqual(['0', '']);
    });

    it('does NOT animate landed elements on a multi-source drop (scaleY landing removed)', () => {
        const state = { groups: [], ungrouped: ['source-1', 'source-2', 'source-3'] };
        const saveState = jest.fn();
        const render = jest.fn();
        const sourcesByKey = new Map([
            ['source-1', { key: 'source-1' }],
            ['source-2', { key: 'source-2' }],
            ['source-3', { key: 'source-3' }]
        ]);
        const landedA = { classList: createClassList(['source-item']), addEventListener: jest.fn(), style: {} };
        const landedB = { classList: createClassList(['source-item']), addEventListener: jest.fn(), style: {} };
        const sourcesListEl = {
            id: 'sources-list',
            querySelector: jest.fn((selector) => {
                if (selector === '[data-source-key="source-1"]') return landedA;
                if (selector === '[data-source-key="source-2"]') return landedB;
                return null;
            })
        };
        const shadowRoot = {
            querySelector: jest.fn(() => null),
            querySelectorAll: jest.fn(() => []),
            getElementById: jest.fn((id) => (id === 'sources-list' ? sourcesListEl : null))
        };
        const dropTarget = {
            dataset: { sourceKey: 'source-3' },
            classList: createClassList(['source-item'])
        };
        const session = {
            draggedKeys: new Set(['source-1', 'source-2']),
            currentIntent: {
                kind: 'after-source',
                targetGroup: null,
                targetList: state.ungrouped,
                insertIndex: 3,
                targetGroupId: null,
                slotKey: 'source-3'
            },
            shiftedItems: new Map()
        };
        const runtime = { dragReflowSession: session, activeDragContext: { kind: 'source-multi', keys: ['source-1', 'source-2'] } };
        const dragReflow = makeDragReflowMock();

        const interactions = createContentTreeInteractions({
            runtime,
            getState: () => state,
            getGroupsById: () => new Map(),
            getSourcesByKey: () => sourcesByKey,
            getPendingBatchKeys: () => new Set(),
            getParentMap: () => new Map(),
            getShadowRoot: () => shadowRoot,
            saveState,
            render,
            dragMulti: createContentDragMulti({}),
            dragReflow,
            buildParentMap: jest.fn(),
            showToast: jest.fn(),
            getMessage: (k, args) => `${k}:${(args || []).join(',')}`
        });

        const dropEvent = createDropEvent({
            dropTarget,
            sourceKeysJson: JSON.stringify(['source-1', 'source-2'])
        });
        dropEvent.clientX = 160;
        dropEvent.clientY = 220;
        interactions.handleDrop(dropEvent);

        // Drop landing animation removed entirely — multi-source landed elements should
        // get neither fly-in nor scaleY landing nor accent flash. Sibling FLIP for the
        // rest of the list is still in effect (verified in other tests).
        expect(landedA.classList.add).not.toHaveBeenCalledWith('sp-drop-landing');
        expect(landedA.classList.add).not.toHaveBeenCalledWith('sp-drop-landed');
        expect(landedA.classList.add).not.toHaveBeenCalledWith('sp-drop-flying');
        expect(landedB.classList.add).not.toHaveBeenCalledWith('sp-drop-landing');
        expect(landedB.classList.add).not.toHaveBeenCalledWith('sp-drop-landed');
        expect(landedB.classList.add).not.toHaveBeenCalledWith('sp-drop-flying');
    });

    it('clears reflow and unfolds dragged items on an invalid drop (no DOM mutation)', () => {
        // Invalid: dropping a group into its own descendant — handleDrop returns early without mutation.
        const childGroup = { id: 'child', children: [] };
        const state = { groups: ['root'], ungrouped: [] };
        const groupsById = new Map([
            ['root', { id: 'root', children: [{ type: 'group', id: 'child' }] }],
            ['child', childGroup]
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
            currentIntent: {
                kind: 'into-group',
                targetGroup: childGroup,
                targetList: childGroup.children,
                insertIndex: -1,
                targetGroupId: 'child',
                slotKey: null
            },
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
            currentIntent: {
                kind: 'before-source',
                targetGroup: null,
                targetList: state.ungrouped,
                insertIndex: 0,
                targetGroupId: null,
                slotKey: 'source-1'
            },
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
            currentIntent: {
                kind: 'into-group',
                targetGroup: group,
                targetList: group.children,
                insertIndex: -1,
                targetGroupId: 'g1',
                slotKey: null
            },
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

    // Cancellation cue (.sp-drag-cancelled): added by cleanupReflowSession only
    // when dragend runs with a non-null dragReflowSession (= drop did NOT
    // succeed, since handleDrop nulls the session in its success path). Class
    // self-clears via setTimeout(240ms) so the CSS shake + box-shadow fade
    // finish naturally.
    it('adds .sp-drag-cancelled to dragged rows when dragend cancels without a successful drop', () => {
        jest.useFakeTimers();
        try {
            const draggedEl = { classList: createClassList([]) };
            const sourcesListEl = {
                id: 'sources-list',
                querySelector: jest.fn((sel) => (sel.indexOf('"A"') >= 0 ? draggedEl : null))
            };
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
                getState: () => ({ groups: [], ungrouped: ['A', 'B'] }),
                getGroupsById: () => new Map(),
                getPendingBatchKeys: () => new Set(),
                getShadowRoot: () => shadowRoot,
                dragMulti: createContentDragMulti({}),
                dragReflow
            });
            interactions.handleDragEnd({ target: { closest: jest.fn(() => null) } });
            expect(draggedEl.classList.add).toHaveBeenCalledWith('sp-drag-cancelled');
            expect(draggedEl.classList.remove).not.toHaveBeenCalledWith('sp-drag-cancelled');
            jest.advanceTimersByTime(240);
            expect(draggedEl.classList.remove).toHaveBeenCalledWith('sp-drag-cancelled');
        } finally {
            jest.useRealTimers();
        }
    });

    it('does NOT add .sp-drag-cancelled when handleDrop already nulled dragReflowSession (success path)', () => {
        const draggedEl = { classList: createClassList([]) };
        const sourcesListEl = {
            id: 'sources-list',
            querySelector: jest.fn(() => draggedEl)
        };
        const shadowRoot = {
            querySelector: jest.fn(() => null),
            querySelectorAll: jest.fn(() => []),
            getElementById: jest.fn((id) => (id === 'sources-list' ? sourcesListEl : null))
        };
        const runtime = { dragReflowSession: null };
        const dragReflow = makeDragReflowMock();
        const interactions = createContentTreeInteractions({
            runtime,
            getState: () => ({ groups: [], ungrouped: ['A'] }),
            getGroupsById: () => new Map(),
            getPendingBatchKeys: () => new Set(),
            getShadowRoot: () => shadowRoot,
            dragMulti: createContentDragMulti({}),
            dragReflow
        });
        interactions.handleDragEnd({ target: { closest: jest.fn(() => null) } });
        expect(draggedEl.classList.add).not.toHaveBeenCalledWith('sp-drag-cancelled');
    });
});

// applyReflowAfterRender is the bridge between content-render's `render()`
// end-of-cycle hook and the active drag's tracked reflow shifts. Without this
// hook, when render() rebuilds the DOM mid-drag (notebookLM SPA sync, hover-
// expand setState), inline transforms on shifted siblings are dropped by
// patchNode's style-attribute rewrite — siblings visually snap back to layout
// for one frame until the next dragover frame re-applies. The hook lets
// content-render trigger a re-apply at the end of every render() call,
// keeping the shift visible across the rebuild.
describe('applyReflowAfterRender hook', () => {
    let createContentTreeInteractions;
    let createContentDragMulti;

    beforeEach(() => {
        jest.resetModules();
        setupGlobalMocks();
        require('../../src/content/content-native-checkbox-sync.js');
        createContentTreeInteractions = require('../../src/content/content-tree-interactions.js');
        createContentDragMulti = require('../../src/content/content-drag-multi.js');
    });

    afterEach(teardownGlobalMocks);

    function makeReflowMock() {
        return {
            applyReflow: jest.fn(),
            clearReflow: jest.fn(),
            prepareDragSession: jest.fn(),
            foldDraggedItems: jest.fn(),
            unfoldDraggedItems: jest.fn(),
            computeReflow: jest.fn(() => new Map()),
            extractInlineTranslateY: () => 0
        };
    }

    function buildInteractions({ runtime, dragReflow }) {
        const sourcesListEl = { id: 'sources-list' };
        const shadowRoot = {
            querySelector: () => null,
            querySelectorAll: () => [],
            getElementById: (id) => (id === 'sources-list' ? sourcesListEl : null)
        };
        return createContentTreeInteractions({
            runtime,
            getState: () => ({ ungrouped: [], groups: [] }),
            getGroupsById: () => new Map(),
            getParentMap: () => new Map(),
            getShadowRoot: () => shadowRoot,
            dragMulti: createContentDragMulti({}),
            dragReflow
        });
    }

    it('re-applies tracked shifts when called during an active drag with non-empty shiftedItems', () => {
        const dragReflow = makeReflowMock();
        const shifts = new Map([['B', 40], ['C', 40]]);
        const runtime = {
            dragReflowSession: {
                draggedKeys: new Set(['A']),
                itemHeights: new Map(),
                totalDraggedHeight: 40,
                currentIntent: null,
                shiftedItems: shifts
            }
        };
        const interactions = buildInteractions({ runtime, dragReflow });

        interactions.applyReflowAfterRender();

        expect(dragReflow.applyReflow).toHaveBeenCalledTimes(1);
        const args = dragReflow.applyReflow.mock.calls[0][0];
        expect(args.session).toBe(runtime.dragReflowSession);
        // shifts is now a decoupled snapshot (not the live Map) so applyReflow's
        // diff loop sees prev === undefined and re-applies onto rebuilt nodes
        // instead of short-circuiting on `prev === delta`.
        expect(args.shifts).not.toBe(shifts);
        expect(args.shifts).toEqual(new Map([['B', 40], ['C', 40]]));
    });

    it('is a cheap no-op when there is no active drag session', () => {
        const dragReflow = makeReflowMock();
        const runtime = { dragReflowSession: null };
        const interactions = buildInteractions({ runtime, dragReflow });

        interactions.applyReflowAfterRender();

        expect(dragReflow.applyReflow).not.toHaveBeenCalled();
    });

    it('skips when drag session exists but no shifts are tracked (early dragover, empty shiftedItems)', () => {
        const dragReflow = makeReflowMock();
        const runtime = {
            dragReflowSession: {
                draggedKeys: new Set(['A']),
                itemHeights: new Map(),
                totalDraggedHeight: 0,
                currentIntent: null,
                shiftedItems: new Map() // empty
            }
        };
        const interactions = buildInteractions({ runtime, dragReflow });

        interactions.applyReflowAfterRender();

        expect(dragReflow.applyReflow).not.toHaveBeenCalled();
    });

    // Regression guard for the no-op bug: applyReflowAfterRender used to pass
    // session.shiftedItems as BOTH `session` and `shifts`, so applyReflow's
    // `prev === delta` short-circuit matched every entry and never touched the
    // DOM. The mock-based tests above could not catch it because they stub out
    // applyReflow entirely. This test wires the REAL reflow engine and asserts
    // the tracked translateY is actually written onto freshly-rendered rows
    // (which carry no inline transform after render() rebuilds them).
    it('writes tracked shifts onto rebuilt DOM nodes via the real reflow engine', () => {
        const createContentDragReflow = require('../../src/content/content-drag-reflow.js');
        const dragReflow = createContentDragReflow({});

        const makeRow = (key) => ({
            style: {},
            classList: makeMockClassList(['source-item']),
            dataset: { sourceKey: key }
        });
        const rows = { B: makeRow('B'), C: makeRow('C') };
        const container = {
            querySelector: (sel) => {
                const m = sel.match(/\[data-source-key="(.+?)"\]/);
                return m && rows[m[1]] ? rows[m[1]] : null;
            }
        };
        const shadowRoot = {
            querySelector: () => null,
            querySelectorAll: () => [],
            getElementById: (id) => (id === 'sources-list' ? container : null)
        };
        const runtime = {
            dragReflowSession: {
                draggedKeys: new Set(['A']),
                itemHeights: new Map(),
                totalDraggedHeight: 40,
                currentIntent: null,
                shiftedItems: new Map([['B', 40], ['C', 40]])
            }
        };
        const interactions = createContentTreeInteractions({
            runtime,
            getState: () => ({ ungrouped: [], groups: [] }),
            getGroupsById: () => new Map(),
            getParentMap: () => new Map(),
            getShadowRoot: () => shadowRoot,
            dragMulti: createContentDragMulti({}),
            dragReflow
        });

        interactions.applyReflowAfterRender();

        expect(rows.B.style.transform).toBe('translateY(40px)');
        expect(rows.C.style.transform).toBe('translateY(40px)');
        expect(rows.B.classList.contains('sp-drop-shift')).toBe(true);
        expect(rows.C.classList.contains('sp-drop-shift')).toBe(true);
        // The live Map is restored to the same content after the re-apply.
        expect(runtime.dragReflowSession.shiftedItems).toEqual(new Map([['B', 40], ['C', 40]]));
    });
});

// H3: when the cursor leaves #sources-list, handleDragLeave must cancel any
// dragover work already queued for the next animation frame. Otherwise the
// queued frame still runs _processDragOver → armHoverExpandTimerForGroup,
// re-arming a hover-expand timer after the pointer has already left the list.
describe('handleDragLeave cancels pending dragover RAF', () => {
    let createContentTreeInteractions;
    let createContentDragMulti;
    let originalRaf;
    let originalCancelRaf;

    beforeEach(() => {
        jest.resetModules();
        setupGlobalMocks();
        require('../../src/content/content-native-checkbox-sync.js');
        createContentTreeInteractions = require('../../src/content/content-tree-interactions.js');
        createContentDragMulti = require('../../src/content/content-drag-multi.js');
        originalRaf = globalThis.requestAnimationFrame;
        originalCancelRaf = globalThis.cancelAnimationFrame;
    });

    afterEach(() => {
        if (originalRaf === undefined) delete globalThis.requestAnimationFrame;
        else globalThis.requestAnimationFrame = originalRaf;
        if (originalCancelRaf === undefined) delete globalThis.cancelAnimationFrame;
        else globalThis.cancelAnimationFrame = originalCancelRaf;
        teardownGlobalMocks();
    });

    it('cancels the queued dragover frame when the cursor leaves #sources-list', () => {
        // RAF returns an id but does NOT run the callback, so the dragover work
        // stays queued (_pendingDragOverRafId != null) like it would mid-drag
        // between two animation frames.
        globalThis.requestAnimationFrame = jest.fn(() => 777);
        globalThis.cancelAnimationFrame = jest.fn();

        const runtime = { hoverExpandTimers: new Map(), hoverExpandedGroupIds: new Set() };
        const shadowRoot = {
            getElementById: () => null,
            querySelector: () => null,
            querySelectorAll: () => []
        };
        const tree = createContentTreeInteractions({
            runtime,
            getState: () => ({ ungrouped: [], groups: [] }),
            getGroupsById: () => new Map(),
            getPendingBatchKeys: () => new Set(),
            getShadowRoot: () => shadowRoot,
            getParentMap: () => new Map(),
            getSetTimeout: () => globalThis.setTimeout,
            dragMulti: createContentDragMulti({})
        });

        tree.handleDragOver({
            target: { closest: () => null },
            clientX: 0,
            clientY: 0,
            preventDefault: jest.fn(),
            dataTransfer: { dropEffect: 'move' }
        });
        expect(globalThis.requestAnimationFrame).toHaveBeenCalledTimes(1);

        tree.handleDragLeave({ target: { id: 'sources-list', closest: () => null } });

        expect(globalThis.cancelAnimationFrame).toHaveBeenCalledWith(777);
    });
});

describe('handleDragEnd post-drop hover refresh', () => {
    let createContentTreeInteractions;
    let createContentDragMulti;

    beforeEach(() => {
        jest.resetModules();
        setupGlobalMocks();
        require('../../src/content/content-native-checkbox-sync.js');
        createContentTreeInteractions = require('../../src/content/content-tree-interactions.js');
        createContentDragMulti = require('../../src/content/content-drag-multi.js');
    });

    afterEach(teardownGlobalMocks);

    function buildHoverRefreshFixture() {
        const cursorClasses = new Set();
        let cursorEl;
        cursorEl = {
            classList: {
                add: jest.fn((c) => cursorClasses.add(c)),
                remove: jest.fn((c) => cursorClasses.delete(c)),
                contains: jest.fn((c) => cursorClasses.has(c))
            },
            closest: jest.fn((sel) => (sel === '.source-item, .group-header' ? cursorEl : null)),
            dispatchEvent: jest.fn(() => true)
        };

        const listClasses = new Set();
        const pseudoNodes = new Set();
        const sourcesListEl = {
            id: 'sources-list',
            classList: {
                add: jest.fn((c) => listClasses.add(c)),
                remove: jest.fn((c) => listClasses.delete(c)),
                contains: jest.fn((c) => listClasses.has(c))
            },
            querySelectorAll: jest.fn((sel) => {
                if (sel === '.sp-pseudo-hover') {
                    return Array.from(pseudoNodes).filter((n) => n.classList.contains('sp-pseudo-hover'));
                }
                return [];
            })
        };

        const cursorAddOriginal = cursorEl.classList.add;
        cursorEl.classList.add = jest.fn((c) => {
            cursorAddOriginal(c);
            if (c === 'sp-pseudo-hover') pseudoNodes.add(cursorEl);
        });

        const shadowRoot = {
            querySelector: jest.fn(() => null),
            querySelectorAll: jest.fn(() => []),
            getElementById: jest.fn((id) => (id === 'sources-list' ? sourcesListEl : null)),
            elementFromPoint: jest.fn(() => cursorEl)
        };

        const captureListeners = new Map();
        const fakeDocument = {
            addEventListener: jest.fn((type, handler, capture) => {
                if (capture !== true) return;
                const list = captureListeners.get(type) || [];
                list.push(handler);
                captureListeners.set(type, list);
            }),
            removeEventListener: jest.fn((type, handler, capture) => {
                if (capture !== true) return;
                const list = captureListeners.get(type) || [];
                captureListeners.set(type, list.filter((h) => h !== handler));
            }),
            elementFromPoint: jest.fn(() => null)
        };

        const interactions = createContentTreeInteractions({
            runtime: {},
            getState: () => ({ groups: [], ungrouped: [] }),
            getGroupsById: () => new Map(),
            getParentMap: () => new Map(),
            getPendingBatchKeys: () => new Set(),
            getShadowRoot: () => shadowRoot,
            getDocument: () => fakeDocument,
            getSetTimeout: () => () => 0,
            dragMulti: createContentDragMulti({}),
            dragReflow: { clearReflow: jest.fn(), unfoldDraggedItems: jest.fn() }
        });

        function fireCapture(type, event) {
            const handlers = captureListeners.get(type) || [];
            handlers.forEach((h) => h(event));
        }

        return {
            interactions,
            cursorEl,
            sourcesListEl,
            cursorClasses,
            listClasses,
            captureListeners,
            fireCapture
        };
    }

    it('injects .sp-pseudo-hover on cursor-under element and .sp-drag-active on #sources-list', () => {
        const { interactions, cursorClasses, listClasses } = buildHoverRefreshFixture();

        interactions.handleDragEnd({ target: { closest: () => null }, clientX: 100, clientY: 200 });

        // Cursor element gets pseudo-hover so it renders the hover affordance immediately.
        expect(cursorClasses.has('sp-pseudo-hover')).toBe(true);
        // Source list gets drag-active so CSS can suppress stale native :hover on the
        // dragstart element (Chrome leaves :hover stuck there until the user moves
        // the mouse for real).
        expect(listClasses.has('sp-drag-active')).toBe(true);
    });

    it('ignores untrusted (synthetic) mousemove — our own dispatch must not self-clear the pseudo state', () => {
        const { interactions, cursorClasses, listClasses, fireCapture, captureListeners } = buildHoverRefreshFixture();

        interactions.handleDragEnd({ target: { closest: () => null }, clientX: 100, clientY: 200 });

        // handleDragEnd dispatches a synthetic mousemove to try to nudge Chrome's
        // native :hover; that dispatch bubbles to document where _onCleanup runs in
        // capture phase. If _onCleanup did not gate on isTrusted, it would erase
        // the pseudo state in the same frame, leaving stale native :hover unopposed.
        expect((captureListeners.get('mousemove') || []).length).toBeGreaterThan(0);
        fireCapture('mousemove', { isTrusted: false, type: 'mousemove' });

        expect(cursorClasses.has('sp-pseudo-hover')).toBe(true);
        expect(listClasses.has('sp-drag-active')).toBe(true);
    });

    it('clears .sp-pseudo-hover and .sp-drag-active on the first trusted user pointer event', () => {
        const { interactions, cursorClasses, listClasses, fireCapture } = buildHoverRefreshFixture();

        interactions.handleDragEnd({ target: { closest: () => null }, clientX: 100, clientY: 200 });
        expect(cursorClasses.has('sp-pseudo-hover')).toBe(true);
        expect(listClasses.has('sp-drag-active')).toBe(true);

        fireCapture('mousemove', { isTrusted: true, type: 'mousemove' });

        expect(cursorClasses.has('sp-pseudo-hover')).toBe(false);
        expect(listClasses.has('sp-drag-active')).toBe(false);
    });
});

describe('empty-bin ungroup dropzone (transient element)', () => {
    let createContentTreeInteractions;

    beforeEach(() => {
        jest.resetModules();
        setupGlobalMocks();
        require('../../src/content/content-native-checkbox-sync.js');
        createContentTreeInteractions = require('../../src/content/content-tree-interactions.js');
    });
    afterEach(teardownGlobalMocks);

    function makeAppendableList(base) {
        // Augment the mock sources-list with appendChild / removeChild / a children
        // registry so the dropzone helper can mount + query its transient element.
        const appended = [];
        base.appendChild = jest.fn((node) => { appended.push(node); return node; });
        base.removeChild = jest.fn((node) => {
            const i = appended.indexOf(node);
            if (i >= 0) appended.splice(i, 1);
            return node;
        });
        const origQS = base.querySelector.bind(base);
        base.querySelector = (sel) => {
            if (sel === '.sp-ungroup-dropzone') {
                return appended.find((n) => n.classList && n.classList.contains('sp-ungroup-dropzone')) || null;
            }
            return origQS(sel);
        };
        return appended;
    }

    // Document stub whose createElement yields a node with a working classList.contains
    // and textContent (the default harness mock has neither) so the helper's
    // getDocument().createElement(...) + createTextNode(...) path is inspectable.
    function makeDocStub() {
        return {
            createElement: jest.fn(() => {
                const classes = new Set();
                return {
                    set className(v) { classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach((c) => classes.add(c)); },
                    get className() { return Array.from(classes).join(' '); },
                    classList: { contains: (c) => classes.has(c) },
                    textContent: '',
                    appendChild(node) { if (node && typeof node.__text === 'string') this.textContent += node.__text; return node; }
                };
            }),
            createTextNode: jest.fn((text) => ({ __text: String(text) }))
        };
    }

    it('mounts .sp-ungroup-dropzone when a source drag is below all root content and the bin is empty', () => {
        const state = { ungrouped: [], root: [{ type: 'source', key: 'A' }] };
        const { sourcesListEl, shadowRoot } = makeMockShadowList({
            items: [{ kind: 'source', key: 'A', top: 100, height: 40 }],
            listRect: { top: 0, bottom: 1000, height: 1000 }
        });
        const appended = makeAppendableList(sourcesListEl);

        const docStub = makeDocStub();
        const runtime = {};
        const tree = createContentTreeInteractions({
            runtime,
            getState: () => state,
            getGroupsById: () => new Map(),
            getParentMap: () => new Map(),
            getShadowRoot: () => shadowRoot,
            getDocument: () => docStub,
            getMessage: (key) => (key === 'ui_drop_to_ungroup_hint' ? 'Drop here to ungroup' : key)
        });
        // Arm a drag session so reflow + intent path runs.
        runtime.activeDragContext = { kind: 'source-single' };
        runtime.dragReflowSession = { draggedKeys: new Set(['DRAG']), totalDraggedHeight: 40, currentIntent: null };

        tree.handleDragOver({ preventDefault() {}, clientX: 100, clientY: 400, dataTransfer: {} });

        const zone = sourcesListEl.querySelector('.sp-ungroup-dropzone');
        expect(zone).toBeTruthy();
        expect(zone.textContent).toBe('Drop here to ungroup');
        expect(appended.length).toBe(1);
    });

    it('does NOT mount the dropzone (and removes a stale one) when the intent is not empty-bin-trailing', () => {
        const state = { ungrouped: [], root: [{ type: 'source', key: 'A' }] };
        const { sourcesListEl, shadowRoot } = makeMockShadowList({
            items: [{ kind: 'source', key: 'A', top: 100, height: 40 }],
            listRect: { top: 0, bottom: 1000, height: 1000 }
        });
        const appended = makeAppendableList(sourcesListEl);

        const docStub = makeDocStub();
        const runtime = {};
        const tree = createContentTreeInteractions({
            runtime,
            getState: () => state,
            getGroupsById: () => new Map(),
            getParentMap: () => new Map(),
            getShadowRoot: () => shadowRoot,
            getDocument: () => docStub,
            getMessage: (key) => key
        });
        runtime.activeDragContext = { kind: 'source-single' };
        runtime.dragReflowSession = { draggedKeys: new Set(['DRAG']), totalDraggedHeight: 40, currentIntent: null };

        // First: below content + empty bin → mount.
        tree.handleDragOver({ preventDefault() {}, clientX: 100, clientY: 400, dataTransfer: {} });
        expect(sourcesListEl.querySelector('.sp-ungroup-dropzone')).toBeTruthy();

        // Then: cursor in the upper half of A (y=110) → before-source intent, not trailing.
        tree.handleDragOver({ preventDefault() {}, clientX: 100, clientY: 110, dataTransfer: {} });
        expect(sourcesListEl.querySelector('.sp-ungroup-dropzone')).toBeNull();
        expect(appended.length).toBe(0);
    });
});
