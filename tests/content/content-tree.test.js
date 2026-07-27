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
            _listeners: new Map(),
            rect: { top: childrenStart, bottom: childrenEnd, height: childrenEnd - childrenStart, left: 0, right: 200, width: 200 },
            getBoundingClientRect() { return this.rect; },
            addEventListener(type, listener) {
                if (!this._listeners.has(type)) this._listeners.set(type, new Set());
                this._listeners.get(type).add(listener);
            },
            removeEventListener(type, listener) {
                this._listeners.get(type)?.delete(listener);
            },
            dispatchEvent(event) {
                const payload = event || {};
                if (!payload.target) payload.target = this;
                for (const listener of Array.from(this._listeners.get(payload.type) || [])) {
                    listener.call(this, payload);
                }
                return true;
            },
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
            _children: childElements,
            _header: headerEl,
            _childrenHost: childrenEl
        };
        headerEl.parentElement = container;
        childrenEl.parentElement = container;
        childElements.forEach((childElement) => {
            childElement.parentElement = childrenEl;
        });
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
        binItemEls.forEach((binItemEl) => {
            binItemEl.parentElement = ungroupedSectionEl;
        });
    }

    const geometryElements = [];
    function appendGeometryElements(elements) {
        elements.forEach((element) => {
            geometryElements.push(element);
            if (element && element.classList && element.classList.contains('group-container')) {
                geometryElements.push(element._header, element._childrenHost);
                appendGeometryElements(element._children || []);
            }
        });
    }
    appendGeometryElements(rootChildren);
    if (ungroupedSectionEl) {
        geometryElements.push(ungroupedSectionEl);
        const binItems = ungroupedSectionEl.querySelectorAll(':scope > .source-item');
        geometryElements.push(...binItems);
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
            if (
                selector === '.source-item[data-source-key], .group-container[data-group-id], .group-header, .group-children, .ungrouped-section, .sp-ungroup-dropzone'
            ) {
                return geometryElements.slice();
            }
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
        },
        contains: (element) => element === sourcesListEl || geometryElements.includes(element)
    };
    rootChildren.forEach((element) => {
        element.parentElement = sourcesListEl;
    });

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

    const createDropEvent = ({
        dropTarget,
        sourceKey = '',
        sourceKeys = '',
        groupId = ''
    }) => ({
        preventDefault: jest.fn(),
        target: {
            closest: jest.fn(() => dropTarget)
        },
        dataTransfer: {
            getData: jest.fn((type) => {
                if (type === 'application/source-key') return sourceKey;
                if (type === 'application/source-keys') {
                    return Array.isArray(sourceKeys) ? JSON.stringify(sourceKeys) : sourceKeys;
                }
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

    it('injects the shared placement instance into production tree consumers', () => {
        const indexSource = fs.readFileSync(
            path.join(__dirname, '../../src/content/index.js'),
            'utf8'
        );

        expect(indexSource).toContain('treePlacement: _treePlacementModule,');
        expect(indexSource).toContain(
            'return _treePlacementModule.rebuildParentMap(parentMap);'
        );
        expect(indexSource).toContain(
            'const normalized = _treePlacementModule.normalizePlacementState({'
        );
        expect(indexSource).toContain(
            'placementResult = _treePlacementModule.commitPlacementModel(normalized);'
        );
        expect(indexSource).not.toContain(
            'placementResult = _treePlacementModule.removeSource({'
        );
        expect(indexSource).not.toContain('_getSourceTreePositionForTest');
        expect(indexSource).not.toContain('_getGroupTreePositionForTest');
        expect(indexSource).not.toContain('_isNoopTreeMoveForTest');
    });

    it('creates unique group ids when multiple groups are added in the same millisecond', () => {
        const state = { root: [], ungrouped: [] };
        const groupsById = new Map();
        const saveState = jest.fn();
        const render = jest.fn();
        const buildParentMap = jest.fn();
        const parentMap = new Map();
        const createContentTreePlacement = require('../../src/content/content-tree-placement.js');
        const treePlacement = createContentTreePlacement({
            getState: () => state,
            getGroupsById: () => groupsById
        });
        jest.spyOn(treePlacement, 'addGroup');
        jest.spyOn(treePlacement, 'rebuildParentMap');
        const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(12345);
        const interactions = createContentTreeInteractions({
            treePlacement,
            getState: () => state,
            getGroupsById: () => groupsById,
            getParentMap: () => parentMap,
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
        expect(treePlacement.addGroup).toHaveBeenCalledTimes(2);
        expect(treePlacement.rebuildParentMap).toHaveBeenCalledTimes(2);
        expect(buildParentMap).not.toHaveBeenCalled();
    });

    it('commits a subgroup record and parent edge before observers run', () => {
        const state = {
            root: [{ type: 'group', id: 'parent' }],
            ungrouped: []
        };
        const parent = {
            id: 'parent',
            children: [{ type: 'source', key: 'existing' }]
        };
        const groupsById = new Map([['parent', parent]]);
        const parentMap = new Map();
        const createContentTreePlacement = require('../../src/content/content-tree-placement.js');
        const treePlacement = createContentTreePlacement({
            getState: () => state,
            getGroupsById: () => groupsById
        });
        jest.spyOn(treePlacement, 'addGroup');
        jest.spyOn(treePlacement, 'rebuildParentMap');
        const assertCommitted = () => {
            expect(parent.children).toEqual([
                { type: 'source', key: 'existing' },
                { type: 'group', id: 'group_12345' }
            ]);
            expect(groupsById.get('group_12345')).toMatchObject({
                id: 'group_12345',
                children: [],
                enabled: true,
                collapsed: false,
                isNewlyCreated: true
            });
        };
        const buildParentMap = jest.fn(assertCommitted);
        const render = jest.fn(assertCommitted);
        const saveState = jest.fn(assertCommitted);
        const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(12345);
        const interactions = createContentTreeInteractions({
            treePlacement,
            getState: () => state,
            getGroupsById: () => groupsById,
            getParentMap: () => parentMap,
            buildParentMap,
            render,
            saveState,
            getMessage: (key) => key
        });

        try {
            expect(interactions.handleAddNewGroup('parent')).toBe(true);
        } finally {
            nowSpy.mockRestore();
        }

        assertCommitted();
        expect(state.root).toEqual([{ type: 'group', id: 'parent' }]);
        expect(treePlacement.addGroup).toHaveBeenCalledTimes(1);
        expect(treePlacement.rebuildParentMap).toHaveBeenCalledWith(parentMap);
        expect(parentMap.get('group_12345')).toBe('parent');
        expect(buildParentMap).not.toHaveBeenCalled();
        expect(render).toHaveBeenCalledTimes(1);
        expect(saveState).toHaveBeenCalledWith({ immediate: true, critical: true });
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

    it('preserves source XOR when a single source moves from a group to positioned root', () => {
        const state = {
            root: [
                { type: 'group', id: 'origin' },
                { type: 'group', id: 'anchor' }
            ],
            ungrouped: ['bin-other']
        };
        const origin = {
            id: 'origin',
            children: [{ type: 'source', key: 'S' }]
        };
        const anchor = { id: 'anchor', children: [] };
        const groupsById = new Map([
            ['origin', origin],
            ['anchor', anchor]
        ]);
        const parentMap = new Map([['S', 'origin']]);
        const saveState = jest.fn();
        const render = jest.fn();
        const buildParentMap = jest.fn();
        const runtime = {
            dragReflowSession: {
                draggedKeys: new Set(['S']),
                currentIntent: {
                    kind: 'before-group',
                    targetGroup: null,
                    targetList: state.root,
                    insertIndex: 1,
                    targetGroupId: null,
                    slotKey: 'anchor',
                    isRootList: true,
                    target: {
                        container: 'root',
                        index: 1
                    }
                },
                shiftedItems: new Map()
            }
        };
        const interactions = createContentTreeInteractions({
            runtime,
            getState: () => state,
            getGroupsById: () => groupsById,
            getSourcesByKey: () => new Map([['S', { key: 'S' }]]),
            getParentMap: () => parentMap,
            getShadowRoot: () => ({ querySelectorAll: jest.fn(() => []) }),
            saveState,
            render,
            buildParentMap
        });

        interactions.handleDrop(createDropEvent({
            dropTarget: {
                dataset: { groupId: 'anchor' },
                classList: createClassList(['group-container'])
            },
            sourceKey: 'S'
        }));

        expect(origin.children).toEqual([]);
        expect(state.root).toEqual([
            { type: 'group', id: 'origin' },
            { type: 'source', key: 'S' },
            { type: 'group', id: 'anchor' }
        ]);
        expect(state.ungrouped).toEqual(['bin-other']);
        const occurrences = [
            ...Array.from(groupsById.values()).flatMap((group) => (
                (Array.isArray(group.children) ? group.children : [])
                    .filter((entry) => entry.type === 'source' && entry.key === 'S')
            )),
            ...state.root.filter((entry) => entry.type === 'source' && entry.key === 'S'),
            ...state.ungrouped.filter((key) => key === 'S')
        ];
        expect(occurrences).toHaveLength(1);
        expect(parentMap.has('S')).toBe(false);
        expect(buildParentMap).not.toHaveBeenCalled();
        expect(render).toHaveBeenCalledTimes(1);
        expect(saveState).toHaveBeenCalledWith({ immediate: true, critical: true });
    });

    it('routes a cached single-source drop by semantic target instead of stale targetList identity', () => {
        const state = {
            root: [],
            ungrouped: ['A', 'B']
        };
        const groupsById = new Map();
        const parentMap = new Map();
        const staleUngroupedList = [...state.ungrouped];
        const createContentTreePlacement = require('../../src/content/content-tree-placement.js');
        const treePlacement = createContentTreePlacement({
            getState: () => state,
            getGroupsById: () => groupsById
        });
        jest.spyOn(treePlacement, 'applyPlacement');
        jest.spyOn(treePlacement, 'rebuildParentMap');
        const saveState = jest.fn();
        const render = jest.fn();
        const runtime = {
            dragReflowSession: {
                draggedKeys: new Set(['A']),
                currentIntent: {
                    kind: 'after-source',
                    targetList: staleUngroupedList,
                    insertIndex: 2,
                    targetGroup: null,
                    targetGroupId: null,
                    isUngroupedBin: true,
                    target: {
                        container: 'ungrouped',
                        index: 2
                    },
                    slotKey: 'B'
                },
                shiftedItems: new Map()
            }
        };
        const interactions = createContentTreeInteractions({
            runtime,
            treePlacement,
            getState: () => state,
            getGroupsById: () => groupsById,
            getParentMap: () => parentMap,
            getShadowRoot: () => ({ querySelectorAll: jest.fn(() => []) }),
            saveState,
            render
        });

        interactions.handleDrop(createDropEvent({
            dropTarget: {
                dataset: { sourceKey: 'B' },
                classList: createClassList(['source-item'])
            },
            sourceKey: 'A'
        }));

        expect(treePlacement.applyPlacement).toHaveBeenCalledWith({
            item: { kind: 'source', key: 'A' },
            target: { container: 'ungrouped', index: 2 }
        });
        expect(treePlacement.rebuildParentMap).toHaveBeenCalledWith(parentMap);
        expect(state.root).toEqual([]);
        expect(state.ungrouped).toEqual(['B', 'A']);
        expect(staleUngroupedList).toEqual(['A', 'B']);
        expect(render).toHaveBeenCalledTimes(1);
        expect(saveState).toHaveBeenCalledWith({ immediate: true, critical: true });
    });

    it('moves a positioned root source into the ungrouped bin through placement', () => {
        const state = {
            root: [{ type: 'source', key: 'A' }],
            ungrouped: ['B']
        };
        const parentMap = new Map();
        const saveState = jest.fn();
        const render = jest.fn();
        const runtime = {
            dragReflowSession: {
                draggedKeys: new Set(['A']),
                currentIntent: {
                    kind: 'after-source',
                    targetList: state.ungrouped,
                    insertIndex: 1,
                    targetGroup: null,
                    targetGroupId: null,
                    isUngroupedBin: true,
                    target: {
                        container: 'ungrouped',
                        index: 1
                    },
                    slotKey: 'B'
                },
                shiftedItems: new Map()
            }
        };
        const interactions = createContentTreeInteractions({
            runtime,
            getState: () => state,
            getGroupsById: () => new Map(),
            getParentMap: () => parentMap,
            getShadowRoot: () => ({ querySelectorAll: jest.fn(() => []) }),
            saveState,
            render
        });

        interactions.handleDrop(createDropEvent({
            dropTarget: {
                dataset: { sourceKey: 'B' },
                classList: createClassList(['source-item'])
            },
            sourceKey: 'A'
        }));

        expect(state.root).toEqual([]);
        expect(state.ungrouped).toEqual(['B', 'A']);
        expect(parentMap.size).toBe(0);
        expect(render).toHaveBeenCalledTimes(1);
        expect(saveState).toHaveBeenCalledWith({ immediate: true, critical: true });
    });

    it('does not save, render or rebuild when placement reports a semantic no-op', () => {
        const state = {
            root: [],
            ungrouped: ['A']
        };
        const treePlacement = {
            applyPlacement: jest.fn(() => ({
                ok: true,
                changed: false,
                reason: 'no_change'
            })),
            rebuildParentMap: jest.fn()
        };
        const saveState = jest.fn();
        const render = jest.fn();
        const runtime = {
            dragReflowSession: {
                draggedKeys: new Set(['A']),
                currentIntent: {
                    kind: 'before-group',
                    targetList: state.root,
                    insertIndex: 0,
                    targetGroup: null,
                    targetGroupId: null,
                    isRootList: true,
                    target: {
                        container: 'root',
                        index: 0
                    },
                    slotKey: null
                },
                shiftedItems: new Map()
            }
        };
        const interactions = createContentTreeInteractions({
            runtime,
            treePlacement,
            getState: () => state,
            getGroupsById: () => new Map(),
            getParentMap: () => new Map(),
            getShadowRoot: () => ({ querySelectorAll: jest.fn(() => []) }),
            saveState,
            render
        });

        interactions.handleDrop(createDropEvent({ dropTarget: null, sourceKey: 'A' }));

        expect(treePlacement.applyPlacement).toHaveBeenCalledWith({
            item: { kind: 'source', key: 'A' },
            target: { container: 'root', index: 0 }
        });
        expect(treePlacement.rebuildParentMap).not.toHaveBeenCalled();
        expect(state).toEqual({ root: [], ungrouped: ['A'] });
        expect(render).not.toHaveBeenCalled();
        expect(saveState).not.toHaveBeenCalled();
    });

    it('rejects a malformed explicit semantic target instead of falling back to markers', () => {
        const state = {
            root: [{ type: 'source', key: 'A' }],
            ungrouped: ['B']
        };
        const treePlacement = {
            applyPlacement: jest.fn(() => ({
                ok: true,
                changed: true,
                reason: 'moved'
            })),
            rebuildParentMap: jest.fn()
        };
        const saveState = jest.fn();
        const render = jest.fn();
        const runtime = {
            dragReflowSession: {
                draggedKeys: new Set(['A']),
                currentIntent: {
                    kind: 'after-source',
                    targetList: state.ungrouped,
                    insertIndex: 1,
                    targetGroup: null,
                    targetGroupId: null,
                    isUngroupedBin: true,
                    target: {
                        container: 'ungrouped',
                        index: -1
                    },
                    slotKey: 'B'
                },
                shiftedItems: new Map()
            }
        };
        const interactions = createContentTreeInteractions({
            runtime,
            treePlacement,
            getState: () => state,
            getGroupsById: () => new Map(),
            getParentMap: () => new Map(),
            getShadowRoot: () => ({ querySelectorAll: jest.fn(() => []) }),
            saveState,
            render
        });

        interactions.handleDrop(createDropEvent({ dropTarget: null, sourceKey: 'A' }));

        expect(treePlacement.applyPlacement).not.toHaveBeenCalled();
        expect(treePlacement.rebuildParentMap).not.toHaveBeenCalled();
        expect(state).toEqual({
            root: [{ type: 'source', key: 'A' }],
            ungrouped: ['B']
        });
        expect(render).not.toHaveBeenCalled();
        expect(saveState).not.toHaveBeenCalled();
    });

    it('rejects conflicting group markers before invoking placement', () => {
        const state = {
            root: [
                { type: 'source', key: 'A' },
                { type: 'group', id: 'g1' },
                { type: 'group', id: 'g2' }
            ],
            ungrouped: []
        };
        const groupsById = new Map([
            ['g1', { id: 'g1', children: [] }],
            ['g2', { id: 'g2', children: [] }]
        ]);
        const treePlacement = {
            applyPlacement: jest.fn(() => ({
                ok: true,
                changed: true,
                reason: 'moved'
            })),
            rebuildParentMap: jest.fn()
        };
        const saveState = jest.fn();
        const render = jest.fn();
        const runtime = {
            dragReflowSession: {
                draggedKeys: new Set(['A']),
                currentIntent: {
                    kind: 'into-group',
                    targetList: groupsById.get('g1').children,
                    insertIndex: 0,
                    targetGroup: groupsById.get('g2'),
                    targetGroupId: 'g1',
                    target: {
                        container: 'group',
                        groupId: 'g1',
                        index: 0
                    },
                    slotKey: null
                },
                shiftedItems: new Map()
            }
        };
        const interactions = createContentTreeInteractions({
            runtime,
            treePlacement,
            getState: () => state,
            getGroupsById: () => groupsById,
            getParentMap: () => new Map(),
            getShadowRoot: () => ({ querySelectorAll: jest.fn(() => []) }),
            saveState,
            render
        });

        interactions.handleDrop(createDropEvent({ dropTarget: null, sourceKey: 'A' }));

        expect(treePlacement.applyPlacement).not.toHaveBeenCalled();
        expect(treePlacement.rebuildParentMap).not.toHaveBeenCalled();
        expect(groupsById.get('g1').children).toEqual([]);
        expect(groupsById.get('g2').children).toEqual([]);
        expect(render).not.toHaveBeenCalled();
        expect(saveState).not.toHaveBeenCalled();
    });

    it('rejects ambiguous multi-source and group payloads before either mutation path', () => {
        const state = {
            root: [{ type: 'group', id: 'g1' }],
            ungrouped: ['A', 'B']
        };
        const groupsById = new Map([
            ['g1', { id: 'g1', children: [] }]
        ]);
        const treePlacement = {
            applyPlacement: jest.fn(),
            applyBatchPlacement: jest.fn(),
            rebuildParentMap: jest.fn()
        };
        const saveState = jest.fn();
        const render = jest.fn();
        const runtime = {
            dragReflowSession: {
                draggedKeys: new Set(['A', 'B']),
                currentIntent: {
                    kind: 'into-group',
                    targetList: groupsById.get('g1').children,
                    insertIndex: 0,
                    targetGroup: groupsById.get('g1'),
                    targetGroupId: 'g1',
                    target: {
                        container: 'group',
                        groupId: 'g1',
                        index: 0
                    },
                    slotKey: null
                },
                shiftedItems: new Map()
            }
        };
        const interactions = createContentTreeInteractions({
            runtime,
            treePlacement,
            getState: () => state,
            getGroupsById: () => groupsById,
            getSourcesByKey: () => new Map([
                ['A', { key: 'A' }],
                ['B', { key: 'B' }]
            ]),
            getPendingBatchKeys: () => new Set(['A', 'B']),
            getParentMap: () => new Map(),
            getShadowRoot: () => ({ querySelectorAll: jest.fn(() => []) }),
            saveState,
            render
        });

        interactions.handleDrop(createDropEvent({
            dropTarget: null,
            sourceKeys: ['A', 'B'],
            groupId: 'g1'
        }));

        expect(treePlacement.applyBatchPlacement).not.toHaveBeenCalled();
        expect(treePlacement.applyPlacement).not.toHaveBeenCalled();
        expect(treePlacement.rebuildParentMap).not.toHaveBeenCalled();
        expect(state).toEqual({
            root: [{ type: 'group', id: 'g1' }],
            ungrouped: ['A', 'B']
        });
        expect(render).not.toHaveBeenCalled();
        expect(saveState).not.toHaveBeenCalled();
    });

    it('routes a multi-source drop through semantic batch placement and gates effects on change', () => {
        const state = {
            root: [{ type: 'group', id: 'g1' }],
            ungrouped: ['A', 'B'],
            isBatchMode: true
        };
        const targetGroup = { id: 'g1', children: [] };
        const groupsById = new Map([['g1', targetGroup]]);
        const movedItems = [
            { kind: 'source', key: 'A' },
            { kind: 'source', key: 'B' }
        ];
        const treePlacement = {
            applyBatchPlacement: jest.fn(() => ({
                ok: true,
                changed: true,
                reason: 'moved',
                moved: movedItems,
                skipped: []
            })),
            applyPlacement: jest.fn(),
            rebuildParentMap: jest.fn()
        };
        const pendingBatchKeys = new Set(['A', 'B']);
        const parentMap = new Map();
        const saveState = jest.fn();
        const render = jest.fn();
        const buildParentMap = jest.fn();
        const runtime = {
            activeDragContext: {
                kind: 'source-multi',
                keys: ['A', 'B']
            },
            dragReflowSession: {
                draggedKeys: new Set(['A', 'B']),
                currentIntent: {
                    kind: 'into-group',
                    targetList: targetGroup.children,
                    insertIndex: 0,
                    targetGroup,
                    targetGroupId: 'g1',
                    target: {
                        container: 'group',
                        groupId: 'g1',
                        index: 0
                    },
                    slotKey: null
                },
                shiftedItems: new Map()
            }
        };
        const interactions = createContentTreeInteractions({
            runtime,
            treePlacement,
            getState: () => state,
            getGroupsById: () => groupsById,
            getSourcesByKey: () => new Map([
                ['A', { key: 'A' }],
                ['B', { key: 'B' }]
            ]),
            getPendingBatchKeys: () => pendingBatchKeys,
            getParentMap: () => parentMap,
            getShadowRoot: () => ({ querySelectorAll: jest.fn(() => []) }),
            buildParentMap,
            saveState,
            render
        });

        interactions.handleDrop(createDropEvent({
            dropTarget: null,
            sourceKey: 'A',
            sourceKeys: ['A', 'B']
        }));

        expect(treePlacement.applyBatchPlacement).toHaveBeenCalledWith({
            items: movedItems,
            target: {
                container: 'group',
                groupId: 'g1',
                index: 0
            }
        });
        expect(treePlacement.rebuildParentMap).toHaveBeenCalledWith(parentMap);
        expect(buildParentMap).not.toHaveBeenCalled();
        expect(state.isBatchMode).toBe(false);
        expect(pendingBatchKeys.size).toBe(0);
        expect(render).toHaveBeenCalledTimes(1);
        expect(saveState).toHaveBeenCalledWith({ immediate: true, critical: true });
    });

    it('keeps batch selection and effects untouched when placement reports no change', () => {
        const state = {
            root: [],
            ungrouped: ['A', 'B'],
            isBatchMode: true
        };
        const items = [
            { kind: 'source', key: 'A' },
            { kind: 'source', key: 'B' }
        ];
        const treePlacement = {
            applyBatchPlacement: jest.fn(() => ({
                ok: true,
                changed: false,
                reason: 'no_change',
                moved: [],
                skipped: items.map((item) => ({ item, reason: 'no_change' }))
            })),
            applyPlacement: jest.fn(),
            rebuildParentMap: jest.fn()
        };
        const pendingBatchKeys = new Set(['A', 'B']);
        const saveState = jest.fn();
        const render = jest.fn();
        const runtime = {
            activeDragContext: {
                kind: 'source-multi',
                keys: ['A', 'B']
            },
            dragReflowSession: {
                draggedKeys: new Set(['A', 'B']),
                currentIntent: {
                    kind: 'before-source',
                    targetList: state.ungrouped,
                    insertIndex: 0,
                    targetGroup: null,
                    targetGroupId: null,
                    isUngroupedBin: true,
                    target: {
                        container: 'ungrouped',
                        index: 0
                    },
                    slotKey: 'A'
                },
                shiftedItems: new Map()
            }
        };
        const interactions = createContentTreeInteractions({
            runtime,
            treePlacement,
            getState: () => state,
            getGroupsById: () => new Map(),
            getSourcesByKey: () => new Map([
                ['A', { key: 'A' }],
                ['B', { key: 'B' }]
            ]),
            getPendingBatchKeys: () => pendingBatchKeys,
            getParentMap: () => new Map(),
            getShadowRoot: () => ({ querySelectorAll: jest.fn(() => []) }),
            saveState,
            render
        });

        interactions.handleDrop(createDropEvent({
            dropTarget: null,
            sourceKey: 'A',
            sourceKeys: ['A', 'B']
        }));

        expect(treePlacement.applyBatchPlacement).toHaveBeenCalledWith({
            items,
            target: { container: 'ungrouped', index: 0 }
        });
        expect(treePlacement.rebuildParentMap).not.toHaveBeenCalled();
        expect(state.isBatchMode).toBe(true);
        expect(Array.from(pendingBatchKeys)).toEqual(['A', 'B']);
        expect(render).not.toHaveBeenCalled();
        expect(saveState).not.toHaveBeenCalled();
    });

    it('preserves same-container batch order through the shared placement module', () => {
        const state = {
            root: [],
            ungrouped: ['A', 'B', 'C', 'D'],
            isBatchMode: true
        };
        const groupsById = new Map();
        const parentMap = new Map();
        const createContentTreePlacement = require('../../src/content/content-tree-placement.js');
        const treePlacement = createContentTreePlacement({
            getState: () => state,
            getGroupsById: () => groupsById
        });
        jest.spyOn(treePlacement, 'applyBatchPlacement');
        const pendingBatchKeys = new Set(['B', 'C']);
        const runtime = {
            activeDragContext: {
                kind: 'source-multi',
                keys: ['B', 'C']
            },
            dragReflowSession: {
                draggedKeys: new Set(['B', 'C']),
                currentIntent: {
                    kind: 'after-source',
                    targetList: state.ungrouped,
                    insertIndex: 4,
                    targetGroup: null,
                    targetGroupId: null,
                    isUngroupedBin: true,
                    target: {
                        container: 'ungrouped',
                        index: 4
                    },
                    slotKey: 'D'
                },
                shiftedItems: new Map()
            }
        };
        const interactions = createContentTreeInteractions({
            runtime,
            treePlacement,
            getState: () => state,
            getGroupsById: () => groupsById,
            getSourcesByKey: () => new Map([
                ['A', { key: 'A' }],
                ['B', { key: 'B' }],
                ['C', { key: 'C' }],
                ['D', { key: 'D' }]
            ]),
            getPendingBatchKeys: () => pendingBatchKeys,
            getParentMap: () => parentMap,
            getShadowRoot: () => ({ querySelectorAll: jest.fn(() => []) }),
            saveState: jest.fn(),
            render: jest.fn()
        });

        interactions.handleDrop(createDropEvent({
            dropTarget: null,
            sourceKey: 'B',
            sourceKeys: ['B', 'C']
        }));

        expect(treePlacement.applyBatchPlacement).toHaveBeenCalledWith({
            items: [
                { kind: 'source', key: 'B' },
                { kind: 'source', key: 'C' }
            ],
            target: { container: 'ungrouped', index: 4 }
        });
        expect(state.ungrouped).toEqual(['A', 'D', 'B', 'C']);
    });

    it.each([
        ['missing payload', '', { kind: 'source-multi', keys: ['A', 'B'] }],
        ['malformed JSON', '{bad', { kind: 'source-multi', keys: ['A', 'B'] }],
        ['non-array payload', '{"keys":["A","B"]}', { kind: 'source-multi', keys: ['A', 'B'] }],
        ['single-item payload', ['A'], { kind: 'source-multi', keys: ['A', 'B'] }],
        ['reordered payload', ['B', 'A'], { kind: 'source-multi', keys: ['A', 'B'] }],
        ['duplicate payload', ['A', 'A'], { kind: 'source-multi', keys: ['A', 'B'] }],
        ['non-string payload', ['A', 1], { kind: 'source-multi', keys: ['A', 'B'] }],
        ['mismatched payload', ['A', 'C'], { kind: 'source-multi', keys: ['A', 'B'] }],
        ['missing drag context', ['A', 'B'], null]
    ])('fails closed for an untrusted multi-source %s', (_label, sourceKeys, activeDragContext) => {
        const state = {
            root: [{ type: 'group', id: 'g1' }],
            ungrouped: ['A', 'B'],
            isBatchMode: true
        };
        const targetGroup = { id: 'g1', children: [] };
        const treePlacement = {
            applyPlacement: jest.fn(),
            applyBatchPlacement: jest.fn(),
            rebuildParentMap: jest.fn()
        };
        const pendingBatchKeys = new Set(['A', 'B']);
        const saveState = jest.fn();
        const render = jest.fn();
        const runtime = {
            activeDragContext,
            dragReflowSession: {
                draggedKeys: new Set(['A', 'B']),
                currentIntent: {
                    kind: 'into-group',
                    targetList: targetGroup.children,
                    insertIndex: 0,
                    targetGroup,
                    targetGroupId: 'g1',
                    target: {
                        container: 'group',
                        groupId: 'g1',
                        index: 0
                    },
                    slotKey: null
                },
                shiftedItems: new Map()
            }
        };
        const interactions = createContentTreeInteractions({
            runtime,
            treePlacement,
            getState: () => state,
            getGroupsById: () => new Map([['g1', targetGroup]]),
            getPendingBatchKeys: () => pendingBatchKeys,
            getParentMap: () => new Map(),
            getShadowRoot: () => ({ querySelectorAll: jest.fn(() => []) }),
            saveState,
            render
        });

        interactions.handleDrop(createDropEvent({
            dropTarget: null,
            sourceKey: 'A',
            sourceKeys
        }));

        expect(treePlacement.applyBatchPlacement).not.toHaveBeenCalled();
        expect(treePlacement.applyPlacement).not.toHaveBeenCalled();
        expect(treePlacement.rebuildParentMap).not.toHaveBeenCalled();
        expect(state.isBatchMode).toBe(true);
        expect(Array.from(pendingBatchKeys)).toEqual(['A', 'B']);
        expect(targetGroup.children).toEqual([]);
        expect(saveState).not.toHaveBeenCalled();
        expect(render).not.toHaveBeenCalled();
    });

    it('uses only moved batch items for success counts and landing feedback', () => {
        const state = {
            root: [{ type: 'group', id: 'g1' }],
            ungrouped: ['A'],
            isBatchMode: true
        };
        const targetGroup = { id: 'g1', children: [] };
        const treePlacement = {
            applyPlacement: jest.fn(),
            applyBatchPlacement: jest.fn(() => ({
                ok: true,
                changed: true,
                reason: 'partial',
                moved: [{ kind: 'source', key: 'A' }],
                skipped: [{
                    item: { kind: 'source', key: 'GHOST' },
                    reason: 'not_found'
                }]
            })),
            rebuildParentMap: jest.fn()
        };
        const pendingBatchKeys = new Set(['A', 'GHOST']);
        const showToast = jest.fn();
        const developerLog = jest.fn();
        const sourceList = {
            querySelector: jest.fn(() => null),
            querySelectorAll: jest.fn(() => [])
        };
        const shadowRoot = {
            getElementById: jest.fn((id) => (id === 'sources-list' ? sourceList : null)),
            querySelectorAll: jest.fn(() => [])
        };
        const runtime = {
            activeDragContext: {
                kind: 'source-multi',
                keys: ['A', 'GHOST']
            },
            dragReflowSession: {
                draggedKeys: new Set(['A', 'GHOST']),
                currentIntent: {
                    kind: 'into-group',
                    targetList: targetGroup.children,
                    insertIndex: 0,
                    targetGroup,
                    targetGroupId: 'g1',
                    target: {
                        container: 'group',
                        groupId: 'g1',
                        index: 0
                    },
                    slotKey: null
                },
                shiftedItems: new Map()
            }
        };
        const interactions = createContentTreeInteractions({
            runtime,
            treePlacement,
            getState: () => state,
            getGroupsById: () => new Map([['g1', targetGroup]]),
            getPendingBatchKeys: () => pendingBatchKeys,
            getParentMap: () => new Map(),
            getShadowRoot: () => shadowRoot,
            showToast,
            developerLog,
            saveState: jest.fn(),
            render: jest.fn(),
            getDragMode: () => 'reflow',
            getMessage: (key, args = []) => `${key}:${args.join(',')}`
        });

        interactions.handleDrop(createDropEvent({
            dropTarget: null,
            sourceKey: 'A',
            sourceKeys: ['A', 'GHOST']
        }));

        expect(showToast).toHaveBeenCalledWith('ui_batch_moved_sources_toast:1');
        expect(developerLog).toHaveBeenCalledWith(
            'info',
            'source_action',
            'batch_drag_move',
            { count: 1, intent: 'into-group' }
        );
        expect(sourceList.querySelector).toHaveBeenCalledWith('[data-source-key="A"]');
        expect(sourceList.querySelector).not.toHaveBeenCalledWith(
            '[data-source-key="GHOST"]'
        );
    });

    it('rejects conflicting semantic group markers for a multi-source drop', () => {
        const state = {
            root: [
                { type: 'group', id: 'g1' },
                { type: 'group', id: 'g2' }
            ],
            ungrouped: ['A', 'B'],
            isBatchMode: true
        };
        const g1 = { id: 'g1', children: [] };
        const g2 = { id: 'g2', children: [] };
        const treePlacement = {
            applyPlacement: jest.fn(),
            applyBatchPlacement: jest.fn(),
            rebuildParentMap: jest.fn()
        };
        const runtime = {
            activeDragContext: {
                kind: 'source-multi',
                keys: ['A', 'B']
            },
            dragReflowSession: {
                draggedKeys: new Set(['A', 'B']),
                currentIntent: {
                    kind: 'into-group',
                    targetList: g1.children,
                    insertIndex: 0,
                    targetGroup: g2,
                    targetGroupId: 'g1',
                    target: {
                        container: 'group',
                        groupId: 'g1',
                        index: 0
                    },
                    slotKey: null
                },
                shiftedItems: new Map()
            }
        };
        const interactions = createContentTreeInteractions({
            runtime,
            treePlacement,
            getState: () => state,
            getGroupsById: () => new Map([['g1', g1], ['g2', g2]]),
            getPendingBatchKeys: () => new Set(['A', 'B']),
            getParentMap: () => new Map(),
            getShadowRoot: () => ({ querySelectorAll: jest.fn(() => []) }),
            saveState: jest.fn(),
            render: jest.fn()
        });

        interactions.handleDrop(createDropEvent({
            dropTarget: null,
            sourceKey: 'A',
            sourceKeys: ['A', 'B']
        }));

        expect(treePlacement.applyBatchPlacement).not.toHaveBeenCalled();
        expect(treePlacement.applyPlacement).not.toHaveBeenCalled();
        expect(g1.children).toEqual([]);
        expect(g2.children).toEqual([]);
    });

    it('delegates group-cycle rejection to placement without partially removing the group', () => {
        const state = {
            root: [{ type: 'group', id: 'root' }],
            ungrouped: []
        };
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
        const beforeState = JSON.parse(JSON.stringify(state));
        const beforeGroups = JSON.parse(JSON.stringify(Array.from(groupsById.entries())));
        const treePlacement = {
            applyPlacement: jest.fn(() => ({
                ok: false,
                changed: false,
                reason: 'cycle'
            })),
            rebuildParentMap: jest.fn()
        };
        const isDescendant = jest.fn(() => true);
        const saveState = jest.fn();
        const render = jest.fn();
        const runtime = {
            dragReflowSession: {
                draggedKeys: new Set(['root']),
                currentIntent: {
                    kind: 'into-group',
                    targetList: groupsById.get('child').children,
                    insertIndex: 0,
                    targetGroup: groupsById.get('child'),
                    targetGroupId: 'child',
                    target: {
                        container: 'group',
                        groupId: 'child',
                        index: 0
                    },
                    slotKey: null
                },
                shiftedItems: new Map()
            }
        };
        const interactions = createContentTreeInteractions({
            runtime,
            treePlacement,
            getState: () => state,
            getGroupsById: () => groupsById,
            getParentMap: () => new Map([['child', 'root']]),
            getShadowRoot: () => ({ querySelectorAll: jest.fn(() => []) }),
            isDescendant,
            saveState,
            render
        });

        interactions.handleDrop(createDropEvent({
            dropTarget: {
                dataset: { groupId: 'child' },
                classList: createClassList(['group-container', 'drag-into'])
            },
            groupId: 'root'
        }));

        expect(treePlacement.applyPlacement).toHaveBeenCalledWith({
            item: { kind: 'group', id: 'root' },
            target: { container: 'group', groupId: 'child', index: 0 }
        });
        expect(isDescendant).not.toHaveBeenCalled();
        expect(state).toEqual(beforeState);
        expect(Array.from(groupsById.entries())).toEqual(beforeGroups);
        expect(treePlacement.rebuildParentMap).not.toHaveBeenCalled();
        expect(render).not.toHaveBeenCalled();
        expect(saveState).not.toHaveBeenCalled();
    });

    it('does not save or render when a source is dropped back into the same position', () => {
        const state = { groups: [], ungrouped: ['source-1', 'source-2'] };
        const saveState = jest.fn();
        const render = jest.fn();
        const buildParentMap = jest.fn();
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
                    slotKey: 'source-1',
                    isUngroupedBin: true,
                    target: {
                        container: 'ungrouped',
                        index: 0
                    }
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
            render,
            buildParentMap
        });

        interactions.handleDrop(createDropEvent({ dropTarget, sourceKey: 'source-1' }));

        expect(state.ungrouped).toEqual(['source-1', 'source-2']);
        expect(render).not.toHaveBeenCalled();
        expect(saveState).not.toHaveBeenCalled();
        expect(buildParentMap).not.toHaveBeenCalled();
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
                    slotKey: 'source-2',
                    isUngroupedBin: true,
                    target: {
                        container: 'ungrouped',
                        index: 2
                    }
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

    it('removes the original group-child slot before correcting a forward insertion index', () => {
        const group = {
            id: 'g1',
            children: [
                { type: 'source', key: 'A' },
                { type: 'source', key: 'B' },
                { type: 'source', key: 'C' },
                { type: 'source', key: 'D' }
            ]
        };
        const state = {
            root: [{ type: 'group', id: 'g1' }],
            ungrouped: []
        };
        const saveState = jest.fn();
        const render = jest.fn();
        const buildParentMap = jest.fn();
        const runtime = {
            dragReflowSession: {
                draggedKeys: new Set(['B']),
                currentIntent: {
                    kind: 'after-source',
                    targetGroup: group,
                    targetList: group.children,
                    insertIndex: 3,
                    targetGroupId: 'g1',
                    slotKey: 'C',
                    target: {
                        container: 'group',
                        groupId: 'g1',
                        index: 3
                    }
                },
                shiftedItems: new Map()
            }
        };
        const interactions = createContentTreeInteractions({
            runtime,
            getState: () => state,
            getGroupsById: () => new Map([['g1', group]]),
            getSourcesByKey: () => new Map([['B', { key: 'B' }]]),
            getParentMap: () => new Map([['B', 'g1']]),
            getShadowRoot: () => ({ querySelectorAll: jest.fn(() => []) }),
            saveState,
            render,
            buildParentMap
        });

        interactions.handleDrop(createDropEvent({
            dropTarget: {
                dataset: { sourceKey: 'C' },
                classList: createClassList(['source-item'])
            },
            sourceKey: 'B'
        }));

        expect(group.children).toEqual([
            { type: 'source', key: 'A' },
            { type: 'source', key: 'C' },
            { type: 'source', key: 'B' },
            { type: 'source', key: 'D' }
        ]);
        expect(buildParentMap).not.toHaveBeenCalled();
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
                    slotKey: 'g2',
                    isRootList: true,
                    target: {
                        container: 'root',
                        index: 1
                    }
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
                    slotKey: 'A',
                    isRootList: true,
                    target: {
                        container: 'root',
                        index: 0
                    }
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
        const buildParentMap = jest.fn();
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
                    slotKey: 'src-1',
                    isRootList: true,
                    target: {
                        container: 'root',
                        index: 0
                    }
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
            render,
            buildParentMap
        });

        interactions.handleDrop(createDropEvent({ dropTarget, sourceKey: 'src-1' }));

        expect(state.root).toEqual([
            { type: 'source', key: 'src-1' },
            { type: 'group', id: 'g1' },
            { type: 'source', key: 'src-2' }
        ]);
        expect(render).not.toHaveBeenCalled();
        expect(saveState).not.toHaveBeenCalled();
        expect(buildParentMap).not.toHaveBeenCalled();
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
        const buildParentMap = jest.fn();
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
                    slotKey: 'g2',
                    isRootList: true,
                    target: {
                        container: 'root',
                        index: 2
                    }
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
            render,
            buildParentMap
        });

        interactions.handleDrop(createDropEvent({ dropTarget, groupId: 'g2' }));

        expect(state.root).toEqual([
            { type: 'group', id: 'g1' },
            { type: 'group', id: 'g2' }
        ]);
        expect(render).not.toHaveBeenCalled();
        expect(saveState).not.toHaveBeenCalled();
        expect(buildParentMap).not.toHaveBeenCalled();
    });

    it.each([
        ['itself', 'root'],
        ['its descendant', 'child']
    ])('rejects moving a group into %s atomically', (_label, targetGroupId) => {
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
        const buildParentMap = jest.fn();
        const isDescendant = jest.fn(global.isDescendant);
        const targetGroup = groupsById.get(targetGroupId);
        const dropTarget = {
            dataset: { groupId: targetGroupId },
            classList: createClassList(['group-container', 'drag-into'])
        };
        const runtime = {
            dragReflowSession: {
                draggedKeys: new Set(['root']),
                currentIntent: {
                    kind: 'into-group',
                    targetGroup,
                    targetList: targetGroup.children,
                    insertIndex: 0,
                    targetGroupId,
                    slotKey: null,
                    target: {
                        container: 'group',
                        groupId: targetGroupId,
                        index: 0
                    }
                },
                shiftedItems: new Map()
            }
        };
        const beforeState = JSON.parse(JSON.stringify(state));
        const beforeGroups = JSON.parse(JSON.stringify(Array.from(groupsById.entries())));
        const interactions = createContentTreeInteractions({
            runtime,
            getState: () => state,
            getGroupsById: () => groupsById,
            getParentMap: () => parentMap,
            getShadowRoot: () => ({ querySelectorAll: jest.fn(() => []) }),
            isDescendant,
            saveState,
            render,
            buildParentMap
        });

        interactions.handleDrop(createDropEvent({ dropTarget, groupId: 'root' }));

        expect(isDescendant).not.toHaveBeenCalled();
        expect(state).toEqual(beforeState);
        expect(Array.from(groupsById.entries())).toEqual(beforeGroups);
        expect(render).not.toHaveBeenCalled();
        expect(saveState).not.toHaveBeenCalled();
        expect(buildParentMap).not.toHaveBeenCalled();
    });

    it('deleting a non-empty nested group sends direct sources to the bin and promotes child groups to root in order', () => {
        const state = {
            root: [
                { type: 'group', id: 'existing-root' },
                { type: 'group', id: 'parent' }
            ],
            ungrouped: ['existing-bin'],
            isBatchMode: false
        };
        const parent = {
            id: 'parent',
            children: [
                { type: 'source', key: 'parent-source' },
                { type: 'group', id: 'doomed' },
                { type: 'group', id: 'parent-sibling' }
            ]
        };
        const doomed = {
            id: 'doomed',
            title: 'Doomed',
            children: [
                { type: 'source', key: 'S1' },
                { type: 'group', id: 'child-a' },
                { type: 'source', key: 'S2' },
                { type: 'group', id: 'child-b' }
            ]
        };
        const groupsById = new Map([
            ['existing-root', { id: 'existing-root', children: [] }],
            ['parent', parent],
            ['doomed', doomed],
            ['parent-sibling', { id: 'parent-sibling', children: [] }],
            ['child-a', { id: 'child-a', children: [] }],
            ['child-b', { id: 'child-b', children: [] }]
        ]);
        const confirm = jest.fn(() => true);
        const saveState = jest.fn();
        const render = jest.fn();
        const buildParentMap = jest.fn();
        const parentMap = new Map([
            ['doomed', 'parent'],
            ['parent-sibling', 'parent'],
            ['S1', 'doomed'],
            ['child-a', 'doomed'],
            ['S2', 'doomed'],
            ['child-b', 'doomed']
        ]);
        const createContentTreePlacement = require('../../src/content/content-tree-placement.js');
        const treePlacement = createContentTreePlacement({
            getState: () => state,
            getGroupsById: () => groupsById
        });
        jest.spyOn(treePlacement, 'removeGroup');
        jest.spyOn(treePlacement, 'rebuildParentMap');
        const groupContainer = { dataset: { groupId: 'doomed' } };
        const deleteButton = {};
        const target = {
            classList: { contains: jest.fn(() => false) },
            closest: jest.fn((selector) => {
                if (selector === '.group-container') return groupContainer;
                if (selector === '.sp-delete-button') return deleteButton;
                return null;
            })
        };
        const interactions = createContentTreeInteractions({
            treePlacement,
            getState: () => state,
            getGroupsById: () => groupsById,
            getSourcesByKey: () => new Map(),
            getParentMap: () => parentMap,
            getPendingBatchKeys: () => new Set(),
            getWindow: () => ({ confirm }),
            getMessage: (key) => key,
            saveState,
            render,
            buildParentMap
        });

        interactions.handleInteraction({ target });

        expect(confirm).toHaveBeenCalledTimes(1);
        expect(state.ungrouped).toEqual(['existing-bin', 'S1', 'S2']);
        expect(state.root).toEqual([
            { type: 'group', id: 'existing-root' },
            { type: 'group', id: 'parent' },
            { type: 'group', id: 'child-a' },
            { type: 'group', id: 'child-b' }
        ]);
        expect(parent.children).toEqual([
            { type: 'source', key: 'parent-source' },
            { type: 'group', id: 'parent-sibling' }
        ]);
        expect(groupsById.has('doomed')).toBe(false);
        expect(groupsById.has('child-a')).toBe(true);
        expect(groupsById.has('child-b')).toBe(true);
        expect(treePlacement.removeGroup).toHaveBeenCalledWith({
            item: { kind: 'group', id: 'doomed' }
        });
        expect(treePlacement.rebuildParentMap).toHaveBeenCalledWith(parentMap);
        expect(buildParentMap).not.toHaveBeenCalled();
        expect(saveState).toHaveBeenCalledWith({ immediate: true, critical: true });
        expect(render).toHaveBeenCalledTimes(1);
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
            expect(node.classList.remove).toHaveBeenCalledWith('dragging', 'drag-into', 'drag-invalid', 'drag-over-top', 'drag-over-bottom');
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

    it('moves grouped and positioned-root sources to ungrouped through batch placement', () => {
        const state = {
            root: [
                { type: 'group', id: 'root' },
                { type: 'source', key: 'root-source' }
            ],
            ungrouped: ['source-3'],
            isBatchMode: true
        };
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
            ['source-3', { key: 'source-3', enabled: true }],
            ['root-source', { key: 'root-source', enabled: true }]
        ]);
        const parentMap = new Map([
            ['source-1', 'root'],
            ['child', 'root'],
            ['source-2', 'child']
        ]);
        const pendingBatchKeys = new Set([
            'source-2',
            'root-source',
            'source-1',
            'source-3'
        ]);
        const saveState = jest.fn();
        const render = jest.fn();
        const showToast = jest.fn();
        const buildParentMap = jest.fn();
        const createContentTreePlacement = require('../../src/content/content-tree-placement.js');
        const treePlacement = createContentTreePlacement({
            getState: () => state,
            getGroupsById: () => groupsById
        });
        jest.spyOn(treePlacement, 'applyBatchPlacement');
        jest.spyOn(treePlacement, 'rebuildParentMap');
        const interactions = createContentTreeInteractions({
            treePlacement,
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
        expect(state.root).toEqual([{ type: 'group', id: 'root' }]);
        expect(state.ungrouped).toEqual([
            'source-3',
            'source-1',
            'source-2',
            'root-source'
        ]);
        expect(treePlacement.applyBatchPlacement).toHaveBeenCalledWith({
            items: [
                { kind: 'source', key: 'source-1' },
                { kind: 'source', key: 'source-2' },
                { kind: 'source', key: 'root-source' }
            ],
            target: {
                container: 'ungrouped',
                index: 1
            }
        });
        expect(treePlacement.rebuildParentMap).toHaveBeenCalledWith(parentMap);
        expect(buildParentMap).not.toHaveBeenCalled();
        expect(saveState).toHaveBeenCalledWith({ immediate: true, critical: true });
        expect(render).toHaveBeenCalled();
        expect(pendingBatchKeys.size).toBe(0);
        expect(state.isBatchMode).toBe(false);
        expect(showToast).toHaveBeenCalledWith('ui_batch_ungrouped_toast:3', { variant: 'success' });
    });

    it('preserves batch state when every selected source is already ungrouped', () => {
        const state = {
            root: [],
            ungrouped: ['source-1', 'source-2'],
            isBatchMode: true
        };
        const pendingBatchKeys = new Set(['source-1', 'source-2']);
        const treePlacement = {
            locateItem: jest.fn((item) => ({
                container: 'ungrouped',
                index: item.key === 'source-1' ? 0 : 1
            })),
            applyBatchPlacement: jest.fn(),
            rebuildParentMap: jest.fn()
        };
        const saveState = jest.fn();
        const render = jest.fn();
        const showToast = jest.fn();
        const interactions = createContentTreeInteractions({
            treePlacement,
            getState: () => state,
            getGroupsById: () => new Map(),
            getSourcesByKey: () => new Map([
                ['source-1', { key: 'source-1', enabled: true }],
                ['source-2', { key: 'source-2', enabled: true }]
            ]),
            getPendingBatchKeys: () => pendingBatchKeys,
            getParentMap: () => new Map(),
            saveState,
            render,
            showToast,
            getMessage: (key) => key
        });

        expect(interactions.executeBatchMoveToUngrouped()).toBe(false);
        expect(treePlacement.applyBatchPlacement).not.toHaveBeenCalled();
        expect(treePlacement.rebuildParentMap).not.toHaveBeenCalled();
        expect(state.isBatchMode).toBe(true);
        expect(Array.from(pendingBatchKeys)).toEqual(['source-1', 'source-2']);
        expect(saveState).not.toHaveBeenCalled();
        expect(render).not.toHaveBeenCalled();
        expect(showToast).toHaveBeenCalledWith('ui_batch_no_sources_changed', {
            variant: 'info'
        });
    });

    it('moves grouped sources to ungrouped through source menu helpers', () => {
        const state = {
            root: [{ type: 'group', id: 'root' }],
            ungrouped: ['source-2']
        };
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
        const createContentTreePlacement = require('../../src/content/content-tree-placement.js');
        const treePlacement = createContentTreePlacement({
            getState: () => state,
            getGroupsById: () => groupsById
        });
        jest.spyOn(treePlacement, 'applyPlacement');
        jest.spyOn(treePlacement, 'rebuildParentMap');
        const interactions = createContentTreeInteractions({
            treePlacement,
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
        expect(treePlacement.applyPlacement).toHaveBeenCalledWith({
            item: { kind: 'source', key: 'source-1' },
            target: { container: 'ungrouped', index: 1 }
        });
        expect(treePlacement.rebuildParentMap).toHaveBeenCalledWith(parentMap);
        expect(saveState).toHaveBeenCalledWith({ immediate: true, critical: true });
        expect(render).toHaveBeenCalled();
        expect(showUndoableToast).toHaveBeenCalledWith('ui_keyboard_moved_ungrouped_toast', { variant: 'success' });
    });

    it('handles the click produced by Enter once and restores focus after a source order move', () => {
        const state = {
            root: [
                { type: 'source', key: 'source-a' },
                { type: 'source', key: 'source-b' }
            ],
            ungrouped: []
        };
        const groupsById = new Map();
        const parentMap = new Map();
        const sourcesByKey = new Map([
            ['source-a', { key: 'source-a', title: 'First private title', enabled: true }],
            ['source-b', { key: 'source-b', title: 'Second private title', enabled: true }]
        ]);
        const createContentTreePlacement = require('../../src/content/content-tree-placement.js');
        const treePlacement = createContentTreePlacement({
            getState: () => state,
            getGroupsById: () => groupsById
        });
        jest.spyOn(treePlacement, 'resolveDirectionalTarget');
        jest.spyOn(treePlacement, 'applyPlacement');
        jest.spyOn(treePlacement, 'rebuildParentMap');
        const saveState = jest.fn();
        const render = jest.fn();
        const closeSourceActionMenu = jest.fn();
        const status = { textContent: '' };
        const restoredControl = {
            dataset: { sourceKey: 'source-b' },
            focus: jest.fn()
        };
        const shadowRoot = {
            getElementById: jest.fn((id) => (
                id === 'sp-tree-order-status' ? status : null
            )),
            querySelectorAll: jest.fn((selector) => (
                selector === '.sp-source-actions-button' ? [restoredControl] : []
            ))
        };
        const interactions = createContentTreeInteractions({
            treePlacement,
            getState: () => state,
            getGroupsById: () => groupsById,
            getSourcesByKey: () => sourcesByKey,
            getParentMap: () => parentMap,
            getShadowRoot: () => shadowRoot,
            saveState,
            render,
            closeSourceActionMenu,
            getMessage: (key, args = []) => `${key}:${args.join('/')}`
        });
        const orderButton = {
            dataset: {
                sourceKey: 'source-b',
                treeDirection: 'up'
            },
            classList: { contains: jest.fn(() => false) },
            closest: jest.fn((selector) => (
                selector === '[data-tree-direction]' ? orderButton : null
            ))
        };

        interactions.handleInteraction({ target: orderButton });

        expect(state.root).toEqual([
            { type: 'source', key: 'source-b' },
            { type: 'source', key: 'source-a' }
        ]);
        expect(treePlacement.resolveDirectionalTarget).toHaveBeenCalledTimes(1);
        expect(treePlacement.applyPlacement).toHaveBeenCalledTimes(1);
        expect(treePlacement.rebuildParentMap).toHaveBeenCalledTimes(1);
        expect(closeSourceActionMenu).toHaveBeenCalledTimes(1);
        expect(render).toHaveBeenCalledTimes(1);
        expect(saveState).toHaveBeenCalledTimes(1);
        expect(saveState).toHaveBeenCalledWith({ immediate: true, critical: true });
        expect(restoredControl.focus).toHaveBeenCalledTimes(1);
        expect(status.textContent).toBe('ui_tree_order_moved_up_status:1/2');
        expect(status.textContent).not.toContain('private title');
    });

    it('fails closed when a stale directional control has reached a boundary', () => {
        const state = {
            root: [{ type: 'source', key: 'source-a' }],
            ungrouped: []
        };
        const groupsById = new Map();
        const createContentTreePlacement = require('../../src/content/content-tree-placement.js');
        const treePlacement = createContentTreePlacement({
            getState: () => state,
            getGroupsById: () => groupsById
        });
        jest.spyOn(treePlacement, 'resolveDirectionalTarget');
        jest.spyOn(treePlacement, 'applyPlacement');
        jest.spyOn(treePlacement, 'rebuildParentMap');
        const status = { textContent: '' };
        const saveState = jest.fn();
        const render = jest.fn();
        const interactions = createContentTreeInteractions({
            treePlacement,
            getState: () => state,
            getGroupsById: () => groupsById,
            getSourcesByKey: () => new Map([[
                'source-a',
                { key: 'source-a', title: 'Never announce me', enabled: true }
            ]]),
            getParentMap: () => new Map(),
            getShadowRoot: () => ({
                getElementById: (id) => (id === 'sp-tree-order-status' ? status : null),
                querySelectorAll: () => []
            }),
            saveState,
            render
        });
        const orderButton = {
            dataset: {
                sourceKey: 'source-a',
                treeDirection: 'up'
            },
            classList: { contains: jest.fn(() => false) },
            closest: jest.fn((selector) => (
                selector === '[data-tree-direction]' ? orderButton : null
            ))
        };

        interactions.handleInteraction({ target: orderButton });

        expect(treePlacement.resolveDirectionalTarget).toHaveBeenCalledTimes(1);
        expect(treePlacement.applyPlacement).not.toHaveBeenCalled();
        expect(treePlacement.rebuildParentMap).not.toHaveBeenCalled();
        expect(saveState).not.toHaveBeenCalled();
        expect(render).not.toHaveBeenCalled();
        expect(status.textContent).toBe('');
    });

    it('restores group focus to an enabled sibling control after reaching a boundary', () => {
        const state = {
            root: [
                { type: 'group', id: 'group-a' },
                { type: 'group', id: 'group-b' }
            ],
            ungrouped: []
        };
        const groupsById = new Map([
            ['group-a', { id: 'group-a', title: 'A', children: [] }],
            ['group-b', { id: 'group-b', title: 'B', children: [] }]
        ]);
        const createContentTreePlacement = require('../../src/content/content-tree-placement.js');
        const treePlacement = createContentTreePlacement({
            getState: () => state,
            getGroupsById: () => groupsById
        });
        const movedUpControl = {
            dataset: { groupId: 'group-b', treeDirection: 'up' },
            disabled: true,
            focus: jest.fn()
        };
        const moveDownControl = {
            dataset: { groupId: 'group-b', treeDirection: 'down' },
            disabled: false,
            focus: jest.fn()
        };
        const status = { textContent: '' };
        const render = jest.fn();
        const saveState = jest.fn();
        const interactions = createContentTreeInteractions({
            treePlacement,
            getState: () => state,
            getGroupsById: () => groupsById,
            getParentMap: () => new Map(),
            getShadowRoot: () => ({
                querySelectorAll: jest.fn((selector) => {
                    if (selector === '.sp-tree-order-button') {
                        return [movedUpControl, moveDownControl];
                    }
                    return [];
                }),
                getElementById: (id) => (id === 'sp-tree-order-status' ? status : null)
            }),
            render,
            saveState,
            getMessage: (key, args = []) => `${key}:${args.join('/')}`
        });

        expect(interactions.executeDirectionalTreeMove(
            { kind: 'group', id: 'group-b' },
            'up'
        )).toBe(true);

        expect(state.root.map((entry) => entry.id)).toEqual(['group-b', 'group-a']);
        expect(movedUpControl.focus).not.toHaveBeenCalled();
        expect(moveDownControl.focus).toHaveBeenCalledTimes(1);
        expect(render).toHaveBeenCalledTimes(1);
        expect(saveState).toHaveBeenCalledTimes(1);
        expect(status.textContent).toBe('ui_tree_order_moved_up_status:1/2');
    });

    it('restores focus to the destination caret when moving into a collapsed group', () => {
        const state = {
            root: [
                { type: 'group', id: 'group-a' },
                { type: 'source', key: 'source-b' }
            ],
            ungrouped: []
        };
        const groupsById = new Map([[
            'group-a',
            { id: 'group-a', title: 'A', collapsed: true, children: [] }
        ]]);
        const createContentTreePlacement = require('../../src/content/content-tree-placement.js');
        const treePlacement = createContentTreePlacement({
            getState: () => state,
            getGroupsById: () => groupsById
        });
        const hiddenSourceControl = {
            dataset: { sourceKey: 'source-b' },
            focus: jest.fn(),
            closest: jest.fn((selector) => (
                selector === '.group-children.collapsed' ? {} : null
            ))
        };
        const destinationCaret = {
            focus: jest.fn(),
            closest: jest.fn(() => null)
        };
        const destinationGroup = {
            dataset: { groupId: 'group-a' },
            querySelector: jest.fn((selector) => (
                selector === '.sp-caret' ? destinationCaret : null
            ))
        };
        const status = { textContent: '' };
        const render = jest.fn();
        const saveState = jest.fn();
        const interactions = createContentTreeInteractions({
            treePlacement,
            getState: () => state,
            getGroupsById: () => groupsById,
            getParentMap: () => new Map(),
            getShadowRoot: () => ({
                querySelectorAll: jest.fn((selector) => {
                    if (selector === '.sp-source-actions-button') {
                        return [hiddenSourceControl];
                    }
                    if (selector === '.group-container') {
                        return [destinationGroup];
                    }
                    return [];
                }),
                getElementById: (id) => (id === 'sp-tree-order-status' ? status : null)
            }),
            render,
            saveState,
            getMessage: (key, args = []) => `${key}:${args.join('/')}`
        });

        expect(interactions.executeDirectionalTreeMove(
            { kind: 'source', key: 'source-b' },
            'in'
        )).toBe(true);

        expect(state.root).toEqual([{ type: 'group', id: 'group-a' }]);
        expect(groupsById.get('group-a').children).toEqual([
            { type: 'source', key: 'source-b' }
        ]);
        expect(hiddenSourceControl.focus).not.toHaveBeenCalled();
        expect(destinationCaret.focus).toHaveBeenCalledTimes(1);
        expect(render).toHaveBeenCalledTimes(1);
        expect(saveState).toHaveBeenCalledTimes(1);
        expect(status.textContent).toBe('ui_tree_order_moved_in_status:1/1');
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
        const listClassList = {
            contains: jest.fn(() => true),
            add: jest.fn(),
            remove: jest.fn()
        };
        const sourcesListEl = {
            id: 'sources-list',
            classList: listClassList,
            querySelectorAll: jest.fn(() => [])
        };
        const shadowRoot = {
            getElementById: jest.fn((id) => (id === 'sources-list' ? sourcesListEl : null))
        };

        const interactions = createContentTreeInteractions({
            getState: () => state,
            getGroupsById: () => new Map(),
            getPendingBatchKeys: () => pendingBatchKeys,
            getShadowRoot: () => shadowRoot,
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
        expect(listClassList.remove).toHaveBeenCalledWith('sp-drag-active');
    });

    it.each([
        ['source row without a source key', 'source'],
        ['group header without a group id', 'group'],
        ['unrecognized delegated draggable', 'other']
    ])('clears an active host for %s', (_label, targetKind) => {
        const listClassList = {
            contains: jest.fn(() => true),
            add: jest.fn(),
            remove: jest.fn()
        };
        const sourcesListEl = {
            id: 'sources-list',
            classList: listClassList,
            querySelectorAll: jest.fn(() => [])
        };
        const shadowRoot = {
            getElementById: jest.fn((id) => (id === 'sources-list' ? sourcesListEl : null))
        };
        const sourceTarget = {
            dataset: {},
            classList: { add: jest.fn(), remove: jest.fn() }
        };
        const groupTarget = {
            dataset: {},
            classList: { add: jest.fn(), remove: jest.fn() }
        };
        const target = {
            closest: jest.fn((selector) => {
                if (selector === '.source-item') {
                    return targetKind === 'source' ? sourceTarget : null;
                }
                if (selector === '.group-header') {
                    return targetKind === 'group' ? groupTarget : null;
                }
                return null;
            })
        };
        const dataTransfer = createDataTransfer();
        const interactions = createContentTreeInteractions({
            runtime: {},
            getState: () => ({ isBatchMode: false, ungrouped: [], groups: [] }),
            getGroupsById: () => new Map(),
            getPendingBatchKeys: () => new Set(),
            getShadowRoot: () => shadowRoot,
            getSetTimeout: () => () => {},
            dragMulti: createContentDragMulti({})
        });

        interactions.handleDragStart({ target, dataTransfer });

        expect(listClassList.remove).toHaveBeenCalledWith('sp-drag-active');
        expect(dataTransfer.setData).not.toHaveBeenCalled();
    });

    it('clears an active host when dragstart originates from a batch checkbox', () => {
        const sourceRow = createSourceRow('A');
        const listClassList = {
            contains: jest.fn(() => true),
            add: jest.fn(),
            remove: jest.fn()
        };
        const sourcesListEl = {
            id: 'sources-list',
            classList: listClassList,
            querySelectorAll: jest.fn(() => [])
        };
        const shadowRoot = {
            getElementById: jest.fn((id) => (id === 'sources-list' ? sourcesListEl : null))
        };
        const dataTransfer = createDataTransfer();
        const preventDefault = jest.fn();
        const interactions = createContentTreeInteractions({
            runtime: {},
            getState: () => ({ isBatchMode: true, ungrouped: ['A'], groups: [] }),
            getGroupsById: () => new Map(),
            getPendingBatchKeys: () => new Set(['A']),
            getShadowRoot: () => shadowRoot,
            getSetTimeout: () => () => {},
            dragMulti: createContentDragMulti({})
        });

        interactions.handleDragStart({
            target: {
                closest: createTargetClosestStub(sourceRow, { inCheckbox: true })
            },
            dataTransfer,
            preventDefault
        });

        expect(preventDefault).toHaveBeenCalledTimes(1);
        expect(listClassList.remove).toHaveBeenCalledWith('sp-drag-active');
        expect(dataTransfer.setData).not.toHaveBeenCalled();
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

    it('routes multi-key drops through batch placement, exits batch mode, saves, renders, and toasts', () => {
        const group = { id: 'g1', children: [] };
        const state = {
            isBatchMode: true,
            ungrouped: ['A', 'B', 'C', 'D'],
            root: [{ type: 'group', id: 'g1' }]
        };
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
            activeDragContext: {
                kind: 'source-multi',
                keys: ['A', 'B', 'C']
            },
            dragReflowSession: {
                draggedKeys: new Set(['A', 'B', 'C']),
                currentIntent: {
                    kind: 'into-group',
                    targetGroup: group,
                    targetList: group.children,
                    insertIndex: 0,
                    targetGroupId: 'g1',
                    target: {
                        container: 'group',
                        groupId: 'g1',
                        index: 0
                    },
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
            activeDragContext: {
                kind: 'source-multi',
                keys: ['A', 'B']
            },
            dragReflowSession: {
                draggedKeys: new Set(['A', 'B']),
                // Drop between root groups g1 and g2 → before-group g2 against state.root.
                currentIntent: {
                    kind: 'before-group',
                    targetGroup: null,
                    targetList: state.root,
                    insertIndex: 1,
                    isRootList: true,
                    target: {
                        container: 'root',
                        index: 1
                    },
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
        const state = { isBatchMode: true, ungrouped: ['A', 'B'], root: [] };
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
            activeDragContext: {
                kind: 'source-multi',
                keys: ['A', 'B']
            },
            dragReflowSession: {
                draggedKeys: new Set(['A', 'B']),
                currentIntent: {
                    kind: 'before-source',
                    targetGroup: null,
                    targetList: state.ungrouped,
                    insertIndex: 0,
                    targetGroupId: null,
                    isUngroupedBin: true,
                    target: {
                        container: 'ungrouped',
                        index: 0
                    },
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
        expect(saveState).not.toHaveBeenCalled();
        expect(render).not.toHaveBeenCalled();
        expect(buildParentMap).not.toHaveBeenCalled();
    });

    it('single-source drop moves a source from group A to group B children, updating both groups consistently', () => {
        const groupA = { id: 'gA', children: [{ type: 'source', key: 'A1' }, { type: 'source', key: 'A2' }] };
        const groupB = { id: 'gB', children: [{ type: 'source', key: 'B1' }] };
        const state = {
            isBatchMode: false,
            root: [
                { type: 'group', id: 'gA' },
                { type: 'group', id: 'gB' }
            ],
            ungrouped: []
        };
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
                    slotKey: 'B1',
                    target: {
                        container: 'group',
                        groupId: 'gB',
                        index: 1
                    }
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
        expect(parentMap.get('A1')).toBe('gB');
        expect(buildParentMap).not.toHaveBeenCalled();
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
                    slotKey: 'D',
                    isUngroupedBin: true,
                    target: {
                        container: 'ungrouped',
                        index: 4
                    }
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
        const state = {
            isBatchMode: false,
            root: [{ type: 'group', id: 'g1' }],
            ungrouped: ['A', 'B']
        };
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
                    insertIndex: 0,
                    targetGroupId: 'g1',
                    slotKey: null,
                    target: {
                        container: 'group',
                        groupId: 'g1',
                        index: 0
                    }
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

    it('does not show the "Moved to Ungrouped" hint when a source lands in an EMPTY root corridor (positioned, not binned)', () => {
        // Empty root + a binned source: dropping it into the empty root corridor yields the
        // empty-root intent (isRootList, slotKey null). It becomes a POSITIONED root source,
        // so the discoverability hint about the ungrouped bin must NOT fire.
        const state = { isBatchMode: false, ungrouped: ['A'], root: [] };
        const groupsById = new Map();
        const sourcesByKey = new Map([['A', { key: 'A' }]]);
        const saveState = jest.fn();
        const render = jest.fn();
        const showToast = jest.fn();
        const buildParentMap = jest.fn();
        const developerLog = jest.fn();
        const runtime = {
            dragReflowSession: {
                draggedKeys: new Set(['A']),
                currentIntent: {
                    kind: 'after-source',
                    targetGroup: null,
                    targetList: state.root,
                    isRootList: true,
                    insertIndex: 0,
                    slotKey: null,
                    target: {
                        container: 'root',
                        index: 0
                    }
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

        interactions.handleDrop(createDropEvent({ dropTarget: null, sourceKey: 'A' }));

        // Landed as a positioned root source; bin emptied.
        expect(state.root).toEqual([{ type: 'source', key: 'A' }]);
        expect(state.ungrouped).toEqual([]);
        // The "Moved to Ungrouped" discoverability hint must NOT fire for a positioned drop.
        expect(showToast).not.toHaveBeenCalledWith(expect.stringContaining('ui_keyboard_moved_ungrouped_toast'));
    });

    it('logs batch_drag_move with count and intent.kind on successful multi-drop', () => {
        const group = { id: 'g1', children: [] };
        const state = {
            isBatchMode: true,
            ungrouped: ['A', 'B', 'C', 'D'],
            root: [{ type: 'group', id: 'g1' }]
        };
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
            activeDragContext: {
                kind: 'source-multi',
                keys: ['A', 'B', 'C']
            },
            dragReflowSession: {
                draggedKeys: new Set(['A', 'B', 'C']),
                currentIntent: {
                    kind: 'into-group',
                    targetGroup: group,
                    targetList: group.children,
                    insertIndex: 0,
                    targetGroupId: 'g1',
                    target: {
                        container: 'group',
                        groupId: 'g1',
                        index: 0
                    },
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
        const state = {
            isBatchMode: false,
            root: [{ type: 'group', id: 'g1' }],
            ungrouped: ['A']
        };
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
                    slotKey: null,
                    target: {
                        container: 'group',
                        groupId: 'g1',
                        index: 0
                    }
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
        const state = {
            isBatchMode: true,
            ungrouped: ['A', 'B', 'C'],
            root: [{ type: 'group', id: 'g1' }]
        };
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
            activeDragContext: {
                kind: 'source-multi',
                keys: ['A', 'B', 'C']
            },
            dragReflowSession: {
                draggedKeys: new Set(['A', 'B', 'C']),
                currentIntent: {
                    kind: 'into-group',
                    targetGroup: group,
                    targetList: group.children,
                    insertIndex: 0,
                    targetGroupId: 'g1',
                    target: {
                        container: 'group',
                        groupId: 'g1',
                        index: 0
                    },
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
            querySelectorAll: jest.fn(() => []),
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
        expect(prepCallArgs.draggedType).toBe('source');
        expect(prepCallArgs.rootElement).toBe(sourcesListEl);
        expect(runtime.dragReflowSession).toBeDefined();
        expect(runtime.dragReflowSession.draggedKeys.has('A')).toBe(true);
    });

    it('releases prepared row references after dragstart when no ghost factory is installed', () => {
        const runtime = {};
        const state = { isBatchMode: false, ungrouped: ['A'], groups: [] };
        const sourceRow = createSourceRow('A');
        const preparedElements = new Map([['A', sourceRow]]);
        const session = {
            draggedKeys: new Set(['A']),
            preparedElements,
            itemMetrics: new Map([['A', {
                visualRect: { left: 0, top: 0, width: 100, height: 40 }
            }]]),
            totalDraggedHeight: 40,
            shiftedItems: new Map()
        };
        const sourcesListEl = {
            querySelector: jest.fn(() => sourceRow)
        };
        const interactions = createContentTreeInteractions({
            runtime,
            getState: () => state,
            getGroupsById: () => new Map(),
            getPendingBatchKeys: () => new Set(),
            getShadowRoot: () => ({
                querySelectorAll: jest.fn(() => []),
                getElementById: jest.fn(() => sourcesListEl)
            }),
            getDocument: () => null,
            getSetTimeout: () => () => {},
            dragMulti: {
                resolveDragSelection: ({ originKey }) => ({
                    keys: [originKey],
                    isMulti: false
                })
            },
            dragReflow: {
                prepareDragSession: jest.fn(() => session),
                foldDraggedItems: jest.fn()
            }
        });

        interactions.handleDragStart({
            target: createSourceRowTargetStub(sourceRow),
            dataTransfer: createDataTransfer()
        });

        expect(preparedElements.size).toBe(0);
        expect(session.preparedElements).toBeNull();
        global.__rafCallbacks.forEach((callback) => callback && callback());
        expect(session.preparedElements).toBeNull();
    });

    it('releases prepared row references when ghost creation throws', () => {
        const runtime = {};
        const state = { isBatchMode: false, ungrouped: ['A'], groups: [] };
        const sourceRow = createSourceRow('A');
        const preparedElements = new Map([['A', sourceRow]]);
        const session = {
            draggedKeys: new Set(['A']),
            preparedElements,
            itemMetrics: new Map(),
            totalDraggedHeight: 40,
            shiftedItems: new Map()
        };
        const interactions = createContentTreeInteractions({
            runtime,
            getState: () => state,
            getGroupsById: () => new Map(),
            getPendingBatchKeys: () => new Set(),
            getShadowRoot: () => ({
                querySelectorAll: jest.fn(() => []),
                getElementById: jest.fn(() => ({
                    querySelector: jest.fn(() => sourceRow)
                }))
            }),
            getDocument: () => ({ body: {} }),
            getSetTimeout: () => () => {},
            dragMulti: {
                resolveDragSelection: ({ originKey }) => ({
                    keys: [originKey],
                    isMulti: false
                }),
                cloneSourceItem: jest.fn(() => ({})),
                createMultiDragGhost: jest.fn(() => {
                    throw new Error('ghost failed');
                })
            },
            dragReflow: {
                prepareDragSession: jest.fn(() => session),
                foldDraggedItems: jest.fn()
            }
        });

        expect(() => interactions.handleDragStart({
            target: createSourceRowTargetStub(sourceRow),
            dataTransfer: createDataTransfer()
        })).toThrow('ghost failed');
        expect(preparedElements.size).toBe(0);
        expect(session.preparedElements).toBeNull();
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
        const staleClassListB = {
            contains: jest.fn((name) => name === 'sp-drag-folded'),
            add: jest.fn(),
            remove: jest.fn()
        };
        const staleB = { dataset: { sourceKey: 'B' }, classList: staleClassListB, style: staleStyleB };

        // Stale sibling C: lingering translateY offset.
        const staleStyleC = { transform: 'translateY(40px)' };
        const staleClassListC = {
            contains: jest.fn((name) => (
                name === 'sp-drop-shift'
                || name === 'sp-drop-shift-static'
            )),
            add: jest.fn(),
            remove: jest.fn()
        };
        const staleC = { dataset: { sourceKey: 'C' }, classList: staleClassListC, style: staleStyleC };

        const sourcesListEl = {
            id: 'sources-list',
            querySelectorAll: jest.fn((selector) => {
                if (
                    selector.includes('.sp-drag-folded')
                    && selector.includes('.sp-drop-shift')
                    && selector.includes('.sp-drop-shift-static')
                ) {
                    return [staleB, staleC];
                }
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
        expect(staleClassListC.remove).toHaveBeenCalledWith('sp-drop-shift-static');
        expect(staleStyleC.transform).toBe('');

        // Stale dragReflowSession reference replaced by the new drag's fresh session.
        expect(runtime.dragReflowSession).not.toBe(undefined);
        expect(runtime.dragReflowSession.stale).not.toBe(true);
        expect(runtime.dragReflowSession.draggedKeys.has('A')).toBe(true);
    });

    it('preflight reuses active host state while clearing stale descendant drag cues', () => {
        const runtime = { dragReflowSession: null };
        const state = { isBatchMode: false, ungrouped: ['A'], groups: [] };
        const pendingBatchKeys = new Set();
        const sourceRowA = createSourceRow('A');

        // Cues left armed when a prior drag was interrupted by tab-switch / blur:
        // a group-container's hover-expand build-up + a source-item's cancel shake.
        const stalePending = {
            classList: {
                contains: jest.fn((name) => name === 'sp-hover-expand-pending'),
                add: jest.fn(),
                remove: jest.fn()
            },
            style: {}
        };
        const staleCancelled = {
            classList: {
                contains: jest.fn((name) => name === 'sp-drag-cancelled'),
                add: jest.fn(),
                remove: jest.fn()
            },
            style: {}
        };

        // .sp-drag-active lives on #sources-list itself (the host), not a descendant.
        const listClassList = { contains: jest.fn(() => true), add: jest.fn(), remove: jest.fn() };
        // .sp-drag-guide is a descendant group-children left over from an interrupted drag.
        const staleGuide = {
            classList: {
                contains: jest.fn((name) => name === 'sp-drag-guide'),
                add: jest.fn(),
                remove: jest.fn()
            },
            style: { removeProperty: jest.fn() }
        };
        const sourcesListEl = {
            id: 'sources-list',
            classList: listClassList,
            querySelectorAll: jest.fn((selector) => {
                if (
                    selector.includes('sp-hover-expand-pending')
                    && selector.includes('.sp-drag-guide')
                ) {
                    return [stalePending, staleCancelled, staleGuide];
                }
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
        // A replacement drag keeps the host active instead of restyling the
        // whole list off and on again.
        expect(listClassList.remove).not.toHaveBeenCalledWith('sp-drag-active');
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

    function setupCtx({ state, pendingBatchKeys, groups, parentMap, items, dragMode }) {
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
            getDragMode: () => (dragMode || 'reflow'),
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
        ctx.tree.readDragGeometry({
            rootElement: ctx.sourcesListEl,
            session: null
        });
        const dataTransfer = { dropEffect: 'move' };
        ctx.tree.handleDragOver({
            target: { closest: () => null },
            // pointer in A's upper half → before-source A → slotKey='A' (the dragged key) → invalid
            clientX: 50,
            clientY: 105,
            preventDefault: jest.fn(),
            dataTransfer
        });
        const slotEl = ctx.elementMap.get('source:A');
        expect(slotEl.classList.has('drag-invalid')).toBe(true);
        expect(dataTransfer.dropEffect).toBe('none');
    });

    it('classic mode: into-group highlights the folder header (drag-into) without the reflow guide bar', () => {
        const ctx = setupCtx({
            state: { isBatchMode: false, ungrouped: [], root: [{ type: 'group', id: 'g1' }] },
            pendingBatchKeys: new Set(),
            groups: { g1: { id: 'g1', children: [] } },
            dragMode: 'classic',
            items: [
                { kind: 'group', id: 'g1', top: 100, headerHeight: 40, childrenStart: 140, childrenEnd: 140 }
            ]
        });
        ctx.runtime.activeDragContext = { kind: 'source-single', keys: ['X'] };
        ctx.tree.readDragGeometry({
            rootElement: ctx.sourcesListEl,
            session: null
        });
        expect(ctx.runtime.dragGeometryDirty).toBe(false);
        const dataTransfer = { dropEffect: 'none' };
        ctx.tree.handleDragOver({
            target: { closest: () => null },
            clientX: 100,
            clientY: 110, // on g1 header → into-group
            preventDefault: jest.fn(),
            dataTransfer
        });
        const g1 = ctx.elementMap.get('group:g1');
        expect(g1.classList.has('drag-into')).toBe(true);
        const childrenEl = g1.querySelector('.group-children');
        expect(childrenEl.classList.has('sp-drag-guide')).toBe(false);
        expect(dataTransfer.dropEffect).toBe('move');
    });

    it('classic mode: a within-folder slot gets the blue line (drag-over-top), not the reflow guide', () => {
        const ctx = setupCtx({
            state: { isBatchMode: false, ungrouped: [], root: [{ type: 'group', id: 'g1' }] },
            pendingBatchKeys: new Set(),
            groups: { g1: { id: 'g1', children: [{ type: 'source', key: 'c1' }, { type: 'source', key: 'c2' }] } },
            dragMode: 'classic',
            items: [
                {
                    kind: 'group', id: 'g1', top: 100, headerHeight: 40,
                    childrenStart: 140, childrenEnd: 220,
                    children: [
                        { kind: 'source', key: 'c1', top: 140, height: 40 },
                        { kind: 'source', key: 'c2', top: 180, height: 40 }
                    ]
                }
            ]
        });
        ctx.runtime.activeDragContext = { kind: 'source-single', keys: ['X'] };
        ctx.tree.readDragGeometry({
            rootElement: ctx.sourcesListEl,
            session: null
        });
        expect(ctx.runtime.dragGeometryDirty).toBe(false);
        const dataTransfer = { dropEffect: 'none' };
        ctx.tree.handleDragOver({
            target: { closest: () => null },
            clientX: 100,
            clientY: 145, // upper half of c1 (mid 160) → before-source c1
            preventDefault: jest.fn(),
            dataTransfer
        });
        const c1 = ctx.elementMap.get('source:c1');
        expect(c1.classList.has('drag-over-top')).toBe(true);
        const childrenEl = ctx.elementMap.get('group:g1').querySelector('.group-children');
        expect(childrenEl.classList.has('sp-drag-guide')).toBe(false);
        expect(dataTransfer.dropEffect).toBe('move');
    });

    it('classic mode: synchronously allows a source root slot after normalizing it to the ungrouped bin', () => {
        const ctx = setupCtx({
            state: {
                isBatchMode: false,
                root: [{ type: 'source', key: 'A' }, { type: 'group', id: 'g1' }],
                ungrouped: []
            },
            pendingBatchKeys: new Set(),
            groups: { g1: { id: 'g1', children: [] } },
            dragMode: 'classic',
            items: [
                { kind: 'source', key: 'A', top: 100, height: 40 },
                { kind: 'group', id: 'g1', top: 160, headerHeight: 30, childrenStart: 190, childrenEnd: 190 }
            ]
        });
        ctx.runtime.activeDragContext = { kind: 'source-single', keys: ['A'] };
        ctx.tree.readDragGeometry({
            rootElement: ctx.sourcesListEl,
            session: null
        });
        expect(ctx.runtime.dragGeometryDirty).toBe(false);
        const dataTransfer = { dropEffect: 'none' };

        ctx.tree.handleDragOver({
            target: { closest: () => null },
            clientX: 50,
            clientY: 105,
            preventDefault: jest.fn(),
            dataTransfer
        });

        expect(ctx.elementMap.get('source:A').classList.has('drag-invalid')).toBe(false);
        expect(dataTransfer.dropEffect).toBe('move');
    });

    it('classic mode: synchronously preserves a valid root group reorder', () => {
        const ctx = setupCtx({
            state: {
                isBatchMode: false,
                root: [{ type: 'group', id: 'g1' }, { type: 'group', id: 'g2' }],
                ungrouped: []
            },
            pendingBatchKeys: new Set(),
            groups: {
                g1: { id: 'g1', children: [] },
                g2: { id: 'g2', children: [] }
            },
            dragMode: 'classic',
            items: [
                { kind: 'group', id: 'g1', top: 100, headerHeight: 30, childrenStart: 130, childrenEnd: 130 },
                { kind: 'group', id: 'g2', top: 200, headerHeight: 30, childrenStart: 230, childrenEnd: 230 }
            ]
        });
        ctx.runtime.activeDragContext = { kind: 'group', draggedGroupId: 'g2' };
        ctx.tree.readDragGeometry({
            rootElement: ctx.sourcesListEl,
            session: null
        });
        expect(ctx.runtime.dragGeometryDirty).toBe(false);
        const dataTransfer = { dropEffect: 'none' };

        ctx.tree.handleDragOver({
            target: { closest: () => null },
            clientX: 50,
            clientY: 150,
            preventDefault: jest.fn(),
            dataTransfer
        });

        expect(ctx.elementMap.get('group:g1').classList.has('drag-invalid')).toBe(false);
        expect(ctx.elementMap.get('group:g2').classList.has('drag-invalid')).toBe(false);
        expect(dataTransfer.dropEffect).toBe('move');
    });

    it('reflow mode: the same within-folder slot does not get the classic blue line', () => {
        const ctx = setupCtx({
            state: { isBatchMode: false, ungrouped: [], root: [{ type: 'group', id: 'g1' }] },
            pendingBatchKeys: new Set(),
            groups: { g1: { id: 'g1', children: [{ type: 'source', key: 'c1' }, { type: 'source', key: 'c2' }] } },
            dragMode: 'reflow',
            items: [
                {
                    kind: 'group', id: 'g1', top: 100, headerHeight: 40,
                    childrenStart: 140, childrenEnd: 220,
                    children: [
                        { kind: 'source', key: 'c1', top: 140, height: 40 },
                        { kind: 'source', key: 'c2', top: 180, height: 40 }
                    ]
                }
            ]
        });
        ctx.runtime.activeDragContext = { kind: 'source-single', keys: ['X'] };
        ctx.tree.handleDragOver({
            target: { closest: () => null },
            clientX: 100,
            clientY: 145,
            preventDefault: jest.fn(),
            dataTransfer: { dropEffect: 'move' }
        });
        const c1 = ctx.elementMap.get('source:c1');
        expect(c1.classList.has('drag-over-top')).toBe(false);
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
        ctx.tree.readDragGeometry({
            rootElement: ctx.sourcesListEl,
            session: null
        });
        const dataTransfer = { dropEffect: 'move' };
        ctx.tree.handleDragOver({
            target: { closest: () => null },
            // pointer in g2's header → into-group g2 → invalid (g2 is descendant of g1).
            clientX: 100,
            clientY: 145,
            preventDefault: jest.fn(),
            dataTransfer
        });
        const g2El = ctx.elementMap.get('group:g2');
        expect(g2El.classList.has('drag-invalid')).toBe(true);
        expect(dataTransfer.dropEffect).toBe('none');
    });

    it('does NOT mark a positioned root source slot invalid when dragging a group over it (valid state.root insert)', () => {
        const ctx = setupCtx({
            state: { isBatchMode: false, ungrouped: [], root: [{ type: 'group', id: 'g1' }, { type: 'source', key: 'A' }, { type: 'group', id: 'g2' }] },
            pendingBatchKeys: new Set(),
            groups: {
                g1: { id: 'g1', children: [] },
                g2: { id: 'g2', children: [] }
            },
            items: [
                { kind: 'group', id: 'g1', top: 100, headerHeight: 30, childrenStart: 130, childrenEnd: 130 },
                { kind: 'source', key: 'A', top: 140, height: 40 },
                { kind: 'group', id: 'g2', top: 200, headerHeight: 30, childrenStart: 230, childrenEnd: 230 }
            ]
        });
        // Drag the root folder g2 over the positioned root source A's row.
        ctx.runtime.activeDragContext = { kind: 'group', draggedGroupId: 'g2' };
        ctx.tree.readDragGeometry({
            rootElement: ctx.sourcesListEl,
            session: null
        });
        expect(ctx.runtime.dragGeometryDirty).toBe(false);
        const dataTransfer = { dropEffect: 'move' };
        ctx.tree.handleDragOver({
            target: { closest: () => null },
            // upper half of A (140..180, mid 160) → before-source A against state.root (isRootList).
            clientX: 50,
            clientY: 145,
            preventDefault: jest.fn(),
            dataTransfer
        });
        const slotEl = ctx.elementMap.get('source:A');
        // v5: a folder positioned adjacent to a root source is a valid {type:'group'} insert
        // into state.root — no red outline, drop allowed.
        expect(slotEl.classList.has('drag-invalid')).toBe(false);
        expect(dataTransfer.dropEffect).toBe('move');
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
        ctx.tree.readDragGeometry({
            rootElement: ctx.sourcesListEl,
            session: null
        });
        const dataTransfer = { dropEffect: 'move' };
        ctx.tree.handleDragOver({
            target: { closest: () => null },
            // pointer in B's upper half → before-source B → slotKey='B' (in dragged set) → invalid
            clientX: 50,
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
        ctx.tree.readDragGeometry({
            rootElement: ctx.sourcesListEl,
            session: null
        });
        expect(ctx.runtime.dragGeometryDirty).toBe(false);
        const dataTransfer = { dropEffect: 'move' };
        ctx.tree.handleDragOver({
            target: { closest: () => null },
            clientX: 50,
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
            clientX: 50,
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

        expect(dragReflow.computeReflow).not.toHaveBeenCalled();
        expect(dragReflow.applyReflow).toHaveBeenCalledTimes(1);
        const applyArgs = dragReflow.applyReflow.mock.calls[0][0];
        expect(applyArgs.session).toBe(ctx.runtime.dragReflowSession);
        expect(applyArgs.shifts).toEqual({
            sources: expect.any(Map),
            groups: expect.any(Map)
        });
        expect(applyArgs.shifts.sources).toEqual(new Map([['B', 40]]));
        expect(applyArgs.rootElement).toBe(ctx.sourcesListEl);
        expect(ctx.runtime.dragReflowSession.currentIntent.insertIndex).toBe(1);

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

    function setupCtx({ dragReflow, items, dragMulti: dragMultiOverride = null }) {
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
            dragMulti: dragMultiOverride || createContentDragMulti({}),
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
        return { runtime, tree, sourcesListEl, shadowRoot, elementMap, state };
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

    function primeCleanSnapshot(ctx) {
        const snapshot = ctx.tree.readDragGeometry({
            rootElement: ctx.sourcesListEl,
            session: ctx.runtime.dragReflowSession || null
        });
        expect(snapshot).toBeTruthy();
        expect(ctx.runtime.dragGeometryDirty).toBe(false);
        return snapshot;
    }

    function createTrackedDataTransfer(initialValue, { throwOnSet = false } = {}) {
        let currentValue = initialValue;
        const setter = jest.fn((nextValue) => {
            if (throwOnSet) throw new Error('dropEffect setter unavailable');
            currentValue = nextValue;
        });
        const dataTransfer = {};
        Object.defineProperty(dataTransfer, 'dropEffect', {
            configurable: true,
            get: () => currentValue,
            set: setter
        });
        return {
            dataTransfer,
            setter,
            get value() { return currentValue; }
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
        expect(dragReflow.applyReflow).not.toHaveBeenCalled();

        flushRaf();

        expect(dragReflow.applyReflow).toHaveBeenCalledTimes(1);
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

    it('sets none then move synchronously for coalesced events and never rewrites after the frame', () => {
        const ctx = setupCtx({
            dragReflow: null,
            items: [
                { kind: 'source', key: 'A', top: 100, height: 40 },
                { kind: 'source', key: 'B', top: 140, height: 40 }
            ]
        });
        primeCleanSnapshot(ctx);
        const tracked = createTrackedDataTransfer('move');
        const rootRectSpy = jest.spyOn(ctx.sourcesListEl, 'getBoundingClientRect');
        const rootQuerySpy = jest.spyOn(ctx.sourcesListEl, 'querySelectorAll');
        const sourceRectSpies = ['A', 'B'].map((key) => (
            jest.spyOn(ctx.elementMap.get(`source:${key}`), 'getBoundingClientRect')
        ));
        const readCountBefore = ctx.runtime.dragGeometryReadCount;

        ctx.tree.handleDragOver({
            clientX: 50,
            clientY: 105,
            preventDefault: jest.fn(),
            dataTransfer: tracked.dataTransfer
        });
        expect(tracked.setter).toHaveBeenLastCalledWith('none');
        ctx.tree.handleDragOver({
            clientX: 50,
            clientY: 145,
            preventDefault: jest.fn(),
            dataTransfer: tracked.dataTransfer
        });

        expect(tracked.setter.mock.calls).toEqual([['none'], ['move']]);
        expect(tracked.value).toBe('move');
        expect(pendingRafCallbacks.filter(Boolean)).toHaveLength(1);
        expect(Number(ctx.runtime.dragGeometryReadCount) || 0).toBe(readCountBefore);
        expect(rootRectSpy).not.toHaveBeenCalled();
        expect(rootQuerySpy).not.toHaveBeenCalled();
        sourceRectSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());

        flushRaf();
        expect(tracked.setter.mock.calls).toEqual([['none'], ['move']]);
    });

    it.each([
        ['missing', null],
        ['render dirty', 'render_rows_replaced'],
        ['scroll dirty', 'scroll_position_changed'],
        ['hover dirty', 'hover_expand_started']
    ])('uses conservative move for %s geometry without a synchronous DOM read', (_label, reason) => {
        const ctx = setupCtx({
            dragReflow: null,
            items: [
                { kind: 'source', key: 'A', top: 100, height: 40 },
                { kind: 'source', key: 'B', top: 140, height: 40 }
            ]
        });
        if (reason) {
            primeCleanSnapshot(ctx);
            ctx.tree.invalidateDragGeometry(reason, { schedule: false });
        }
        const tracked = createTrackedDataTransfer('none');
        const rootRectSpy = jest.spyOn(ctx.sourcesListEl, 'getBoundingClientRect');
        const rootQuerySpy = jest.spyOn(ctx.sourcesListEl, 'querySelectorAll');
        const readCountBefore = Number(ctx.runtime.dragGeometryReadCount) || 0;

        ctx.tree.handleDragOver({
            clientX: 50,
            clientY: 105,
            preventDefault: jest.fn(),
            dataTransfer: tracked.dataTransfer
        });

        expect(tracked.setter).toHaveBeenCalledTimes(1);
        expect(tracked.setter).toHaveBeenCalledWith('move');
        expect(tracked.value).toBe('move');
        expect(Number(ctx.runtime.dragGeometryReadCount) || 0).toBe(readCountBefore);
        expect(rootRectSpy).not.toHaveBeenCalled();
        expect(rootQuerySpy).not.toHaveBeenCalled();
    });

    it.each([
        ['non-current snapshot identity', (ctx, snapshot) => ({ ...snapshot })],
        ['old DOM generation', (ctx, snapshot) => {
            ctx.tree.invalidateDragGeometry('render_rows_replaced', { schedule: false });
            return snapshot;
        }],
        ['old drag session', (ctx, snapshot) => {
            ctx.runtime.dragReflowSession = { ...ctx.runtime.dragReflowSession };
            return snapshot;
        }]
    ])('uses conservative move for a clean-looking snapshot with %s and performs no DOM read', (_label, makeStaleSnapshot) => {
        const ctx = setupCtx({
            dragReflow: null,
            items: [
                { kind: 'source', key: 'A', top: 100, height: 40 },
                { kind: 'source', key: 'B', top: 140, height: 40 }
            ]
        });
        const snapshot = primeCleanSnapshot(ctx);
        const staleSnapshot = makeStaleSnapshot(ctx, snapshot);
        const rootRectSpy = jest.spyOn(ctx.sourcesListEl, 'getBoundingClientRect');
        const rootQuerySpy = jest.spyOn(ctx.sourcesListEl, 'querySelectorAll');
        const sourceRectSpies = ['A', 'B'].map((key) => (
            jest.spyOn(ctx.elementMap.get(`source:${key}`), 'getBoundingClientRect')
        ));
        const readCountBefore = Number(ctx.runtime.dragGeometryReadCount) || 0;

        const dropEffect = ctx.tree.resolveSynchronousDropEffect({
            clientX: 50,
            clientY: 105,
            geometrySnapshot: staleSnapshot,
            geometryDirty: false,
            state: ctx.state,
            groupsById: new Map(),
            activeDragContext: ctx.runtime.activeDragContext,
            parentMap: new Map(),
            prevIntent: null
        });

        expect(dropEffect).toBe('move');
        expect(Number(ctx.runtime.dragGeometryReadCount) || 0).toBe(readCountBefore);
        expect(rootRectSpy).not.toHaveBeenCalled();
        expect(rootQuerySpy).not.toHaveBeenCalled();
        sourceRectSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    });

    it('catches a throwing dropEffect setter without blocking preventDefault or scheduling', () => {
        const ctx = setupCtx({
            dragReflow: null,
            items: [
                { kind: 'source', key: 'A', top: 100, height: 40 },
                { kind: 'source', key: 'B', top: 140, height: 40 }
            ]
        });
        primeCleanSnapshot(ctx);
        const tracked = createTrackedDataTransfer('move', { throwOnSet: true });
        const preventDefault = jest.fn();

        expect(() => ctx.tree.handleDragOver({
            clientX: 50,
            clientY: 105,
            preventDefault,
            dataTransfer: tracked.dataTransfer
        })).not.toThrow();

        expect(preventDefault).toHaveBeenCalledTimes(1);
        expect(tracked.setter).toHaveBeenCalledTimes(1);
        expect(pendingRafCallbacks.filter(Boolean)).toHaveLength(1);
        flushRaf();
        expect(tracked.setter).toHaveBeenCalledTimes(1);
    });

    it('does not retain the original DataTransfer after dragover returns', () => {
        const ctx = setupCtx({
            dragReflow: null,
            items: [
                { kind: 'source', key: 'A', top: 100, height: 40 },
                { kind: 'source', key: 'B', top: 140, height: 40 }
            ]
        });
        primeCleanSnapshot(ctx);
        let armed = false;
        const originalDataTransfer = new Proxy({ dropEffect: 'move' }, {
            get(target, property, receiver) {
                if (armed) throw new Error(`retained DataTransfer read: ${String(property)}`);
                return Reflect.get(target, property, receiver);
            },
            set(target, property, value, receiver) {
                if (armed) throw new Error(`retained DataTransfer write: ${String(property)}`);
                return Reflect.set(target, property, value, receiver);
            }
        });

        ctx.tree.handleDragOver({
            clientX: 50,
            clientY: 145,
            preventDefault: jest.fn(),
            dataTransfer: originalDataTransfer
        });
        armed = true;

        expect(() => flushRaf()).not.toThrow();
        expect(() => ctx.tree.handleDrop({
            clientX: 50,
            clientY: 145,
            preventDefault: jest.fn(),
            dataTransfer: { getData: jest.fn(() => '') }
        })).not.toThrow();
        expect(() => ctx.tree.handleDragEnd({
            target: { closest: () => null }
        })).not.toThrow();
    });

    it.each([
        null,
        { kind: 'source-single', keys: [] },
        { kind: 'source-multi', keys: ['A'] },
        { kind: 'group', draggedGroupId: '' },
        { kind: 'external-payload' }
    ])('rejects an unsupported drag context synchronously: %p', (activeDragContext) => {
        const ctx = setupCtx({
            dragReflow: null,
            items: [
                { kind: 'source', key: 'A', top: 100, height: 40 },
                { kind: 'source', key: 'B', top: 140, height: 40 }
            ]
        });
        ctx.runtime.activeDragContext = activeDragContext;
        const tracked = createTrackedDataTransfer('move');

        ctx.tree.handleDragOver({
            clientX: 50,
            clientY: 145,
            preventDefault: jest.fn(),
            dataTransfer: tracked.dataTransfer
        });

        expect(tracked.setter).toHaveBeenCalledTimes(1);
        expect(tracked.setter).toHaveBeenCalledWith('none');
        expect(tracked.value).toBe('none');
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
        expect(ctx.runtime.dragReflowSession.currentIntent.insertIndex).toBe(2);
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
        expect(dragReflow.applyReflow).not.toHaveBeenCalled();
    });

    it('refreshes stationary-pointer intent after auto-scroll and coalesces refresh frames', () => {
        let onDidScroll = null;
        const autoScrollController = {
            tick: jest.fn(),
            stop: jest.fn()
        };
        const dragMulti = {
            EDGE_PX: 60,
            MAX_SPEED: 14,
            computeAutoScrollVelocity: jest.fn(() => 10),
            createAutoScrollController: jest.fn((options) => {
                onDidScroll = options.onDidScroll;
                return autoScrollController;
            })
        };
        const ctx = setupCtx({
            dragReflow: null,
            dragMulti,
            items: [
                { kind: 'source', key: 'A', top: 100, height: 40 },
                { kind: 'source', key: 'B', top: 140, height: 40 },
                { kind: 'source', key: 'C', top: 180, height: 40 },
                { kind: 'source', key: 'D', top: 220, height: 40 }
            ]
        });
        ctx.runtime.activeDragContext = { kind: 'source-single', keys: ['A'] };
        ctx.runtime.dragReflowSession = {
            currentIntent: null,
            draggedKeys: new Set(['A']),
            totalDraggedHeight: 40,
            shiftedItems: new Map(),
            shiftedSourceItems: new Map(),
            shiftedGroupItems: new Map()
        };

        ctx.tree.handleDragOver(makeDragOverEvent(170));
        flushRaf();
        expect(ctx.runtime.dragReflowSession.currentIntent.slotKey).toBe('C');
        expect(onDidScroll).toBeInstanceOf(Function);

        const shiftRows = (delta) => {
            for (const key of ['A', 'B', 'C', 'D']) {
                const row = ctx.elementMap.get(`source:${key}`);
                row.rect = {
                    ...row.rect,
                    top: row.rect.top - delta,
                    bottom: row.rect.bottom - delta
                };
            }
        };
        ctx.sourcesListEl.scrollTop = 20;
        shiftRows(20);
        onDidScroll({
            container: ctx.sourcesListEl,
            before: 0,
            after: 20,
            velocity: 10
        });
        ctx.sourcesListEl.scrollTop = 40;
        shiftRows(20);
        onDidScroll({
            container: ctx.sourcesListEl,
            before: 20,
            after: 40,
            velocity: 10
        });

        expect(pendingRafCallbacks.filter(Boolean)).toHaveLength(1);
        flushRaf();
        expect(ctx.runtime.dragReflowSession.currentIntent).toMatchObject({
            kind: 'before-source',
            slotKey: 'D'
        });
    });

    it('flushes dirty auto-scroll geometry synchronously before drop mutation', () => {
        let onDidScroll = null;
        const dragMulti = {
            EDGE_PX: 60,
            MAX_SPEED: 14,
            computeAutoScrollVelocity: jest.fn(() => 10),
            createAutoScrollController: jest.fn((options) => {
                onDidScroll = options.onDidScroll;
                return {
                    tick: jest.fn(),
                    stop: jest.fn()
                };
            })
        };
        const ctx = setupCtx({
            dragReflow: null,
            dragMulti,
            items: [
                { kind: 'source', key: 'A', top: 100, height: 40 },
                { kind: 'source', key: 'B', top: 140, height: 40 },
                { kind: 'source', key: 'C', top: 180, height: 40 },
                { kind: 'source', key: 'D', top: 220, height: 40 }
            ]
        });
        ctx.runtime.activeDragContext = { kind: 'source-single', keys: ['A'] };
        ctx.runtime.dragReflowSession = {
            currentIntent: null,
            draggedKeys: new Set(['A']),
            totalDraggedHeight: 40,
            shiftedItems: new Map(),
            shiftedSourceItems: new Map(),
            shiftedGroupItems: new Map()
        };

        ctx.tree.handleDragOver(makeDragOverEvent(170));
        flushRaf();
        expect(ctx.runtime.dragReflowSession.currentIntent.slotKey).toBe('C');

        for (const key of ['A', 'B', 'C', 'D']) {
            const row = ctx.elementMap.get(`source:${key}`);
            row.rect = {
                ...row.rect,
                top: row.rect.top - 40,
                bottom: row.rect.bottom - 40
            };
        }
        ctx.sourcesListEl.scrollTop = 40;
        onDidScroll({
            container: ctx.sourcesListEl,
            before: 0,
            after: 40,
            velocity: 10
        });
        expect(pendingRafCallbacks.filter(Boolean)).toHaveLength(1);

        ctx.tree.handleDrop({
            clientX: 50,
            clientY: 170,
            preventDefault: jest.fn(),
            dataTransfer: {
                getData: (type) => (
                    type === 'application/source-key' ? 'A' : ''
                )
            }
        });

        expect(ctx.state.root).toEqual([
            { type: 'source', key: 'B' },
            { type: 'source', key: 'C' },
            { type: 'source', key: 'A' },
            { type: 'source', key: 'D' }
        ]);
        expect(globalThis.cancelAnimationFrame).toHaveBeenCalled();
        const stateAfterDrop = JSON.parse(JSON.stringify(ctx.state));
        flushRaf();
        expect(ctx.state).toEqual(stateAfterDrop);
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

describe('sweepPositionedRootSourcesToBin', () => {
    let createContentTreeInteractions;

    beforeEach(() => {
        jest.resetModules();
        setupGlobalMocks();
        require('../../src/content/content-native-checkbox-sync.js');
        createContentTreeInteractions = require('../../src/content/content-tree-interactions.js');
    });

    afterEach(teardownGlobalMocks);

    it('moves positioned root sources to the end of the ungrouped bin, preserving order', () => {
        const state = {
            root: [
                { type: 'group', id: 'A' },
                { type: 'source', key: 'x' },
                { type: 'group', id: 'B' },
                { type: 'source', key: 'y' }
            ],
            ungrouped: ['z']
        };
        const groupsById = new Map([
            ['A', { id: 'A', children: [] }],
            ['B', { id: 'B', children: [] }]
        ]);
        const tree = createContentTreeInteractions({
            getState: () => state,
            getGroupsById: () => groupsById
        });
        const changed = tree.sweepPositionedRootSourcesToBin(state);
        expect(changed).toBe(true);
        expect(state.root).toEqual([{ type: 'group', id: 'A' }, { type: 'group', id: 'B' }]);
        expect(state.ungrouped).toEqual(['z', 'x', 'y']);
    });

    it('is a no-op when there are no positioned root sources', () => {
        const state = { root: [{ type: 'group', id: 'A' }], ungrouped: ['z'] };
        const groupsById = new Map([['A', { id: 'A', children: [] }]]);
        const tree = createContentTreeInteractions({
            getState: () => state,
            getGroupsById: () => groupsById
        });
        const beforeRoot = state.root;
        const changed = tree.sweepPositionedRootSourcesToBin(state);
        expect(changed).toBe(false);
        expect(state.root).toBe(beforeRoot);
        expect(state.ungrouped).toEqual(['z']);
    });

    it('is idempotent (second run is a no-op)', () => {
        const state = { root: [{ type: 'source', key: 'x' }, { type: 'group', id: 'A' }], ungrouped: [] };
        const groupsById = new Map([['A', { id: 'A', children: [] }]]);
        const tree = createContentTreeInteractions({
            getState: () => state,
            getGroupsById: () => groupsById
        });
        expect(tree.sweepPositionedRootSourcesToBin(state)).toBe(true);
        expect(tree.sweepPositionedRootSourcesToBin(state)).toBe(false);
        expect(state.root).toEqual([{ type: 'group', id: 'A' }]);
        expect(state.ungrouped).toEqual(['x']);
    });

    it('tolerates missing/invalid state, root, and ungrouped', () => {
        const tree = createContentTreeInteractions({});
        expect(tree.sweepPositionedRootSourcesToBin({})).toBe(false);
        expect(tree.sweepPositionedRootSourcesToBin(null)).toBe(false);
        const state = { root: [{ type: 'source', key: 'x' }] };
        expect(tree.sweepPositionedRootSourcesToBin(state)).toBe(true);
        expect(state.ungrouped).toEqual(['x']);
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

    describe('filtered last-visible slot characterization and contract', () => {
        const filteredEntries = [
            { type: 'source', key: 'A' },
            { type: 'source', key: 'hidden-B' },
            { type: 'source', key: 'C' },
            { type: 'source', key: 'hidden-D' }
        ];

        function computeFilteredRootIntent({ clientY, activeDragContext }) {
            const state = {
                root: filteredEntries.map((entry) => ({ ...entry })),
                // Keep the non-empty bin outside this mock's pointer region so a source
                // drag past C characterizes the filtered root slot instead of the
                // intentionally separate empty-bin trailing target.
                ungrouped: ['bin-source']
            };
            const tree = buildTree({ state });
            const { sourcesListEl } = makeMockShadowList({
                items: [
                    { kind: 'source', key: 'A', top: 100, height: 40 },
                    { kind: 'source', key: 'C', top: 140, height: 40 }
                ]
            });
            return tree.computeDropIntent({
                clientY,
                rootElement: sourcesListEl,
                state,
                groupsById: new Map(),
                parentMap: new Map(),
                activeDragContext
            });
        }

        function computeFilteredGroupIntent({ clientY, activeDragContext }) {
            const group = {
                id: 'visible-group',
                children: filteredEntries.map((entry) => ({ ...entry }))
            };
            const state = {
                root: [{ type: 'group', id: group.id }],
                ungrouped: []
            };
            const groupsById = new Map([[group.id, group]]);
            const tree = buildTree({ state, groupsById });
            const { sourcesListEl } = makeMockShadowList({
                items: [{
                    kind: 'group',
                    id: group.id,
                    top: 70,
                    headerHeight: 30,
                    childrenStart: 100,
                    childrenEnd: 180,
                    children: [
                        { kind: 'source', key: 'A', top: 100, height: 40 },
                        { kind: 'source', key: 'C', top: 140, height: 40 }
                    ]
                }]
            });
            return tree.computeDropIntent({
                clientX: 100,
                clientY,
                rootElement: sourcesListEl,
                state,
                groupsById,
                parentMap: new Map(),
                activeDragContext
            });
        }

        it('characterizes active text-search root source before/after C as underlying indices 2/3', () => {
            const dragContext = { kind: 'source-single', keys: ['external'] };
            const before = computeFilteredRootIntent({ clientY: 145, activeDragContext: dragContext });
            const after = computeFilteredRootIntent({ clientY: 175, activeDragContext: dragContext });

            expect(before).toMatchObject({ kind: 'before-source', slotKey: 'C', insertIndex: 2 });
            expect(after).toMatchObject({ kind: 'after-source', slotKey: 'C', insertIndex: 3 });
        });

        it('keeps quick-view group-child before C at index 2 and aligns after C to index 3', () => {
            const dragContext = { kind: 'source-single', keys: ['external'] };
            const before = computeFilteredGroupIntent({ clientY: 145, activeDragContext: dragContext });
            const after = computeFilteredGroupIntent({ clientY: 175, activeDragContext: dragContext });

            expect(before).toMatchObject({ kind: 'before-source', slotKey: 'C', insertIndex: 2 });
            expect(after).toMatchObject({ kind: 'after-source', slotKey: 'C', insertIndex: 3 });
        });

        it('characterizes filtered group reorder before/after visible C at root as underlying indices 2/3', () => {
            const state = {
                root: [
                    { type: 'group', id: 'A' },
                    { type: 'group', id: 'hidden-B' },
                    { type: 'group', id: 'C' },
                    { type: 'group', id: 'hidden-D' }
                ],
                ungrouped: []
            };
            const groupsById = new Map(state.root.map((entry) => [
                entry.id,
                { id: entry.id, children: [] }
            ]));
            const tree = buildTree({ state, groupsById });
            const { sourcesListEl } = makeMockShadowList({
                items: [
                    { kind: 'group', id: 'A', top: 100, headerHeight: 30, childrenStart: 130, childrenEnd: 130 },
                    { kind: 'group', id: 'C', top: 150, headerHeight: 30, childrenStart: 180, childrenEnd: 180 }
                ]
            });
            const args = {
                rootElement: sourcesListEl,
                state,
                groupsById,
                parentMap: new Map(),
                activeDragContext: { kind: 'group', draggedGroupId: 'external' }
            };

            const before = tree.computeDropIntent({ ...args, clientY: 140 });
            const after = tree.computeDropIntent({ ...args, clientY: 185 });

            expect(before).toMatchObject({ kind: 'before-group', slotKey: 'C', insertIndex: 2 });
            expect(after).toMatchObject({ kind: 'after-group', slotKey: 'C', insertIndex: 3 });
        });

        it('characterizes multi-source filtered intent without reordering the selected keys', () => {
            const selectedKeys = ['selected-C', 'selected-A'];
            const activeDragContext = { kind: 'source-multi', keys: selectedKeys };
            const intent = computeFilteredRootIntent({ clientY: 175, activeDragContext });

            expect(intent).toMatchObject({ kind: 'after-source', slotKey: 'C', insertIndex: 3 });
            expect(activeDragContext.keys).toEqual(['selected-C', 'selected-A']);
        });

        it('fails closed when the visible list is empty over a nonempty full list', () => {
            const state = {
                root: filteredEntries.map((entry) => ({ ...entry })),
                ungrouped: []
            };
            const tree = buildTree({ state });
            const { sourcesListEl } = makeMockShadowList({ items: [] });
            const intent = tree.computeDropIntent({
                clientY: 150,
                rootElement: sourcesListEl,
                state,
                groupsById: new Map(),
                parentMap: new Map(),
                activeDragContext: { kind: 'source-single', keys: ['external'] }
            });

            expect(intent).toBeNull();
        });

        describe('anchor-relative filtered drag contract', () => {
            it('maps before/after the last visible source to the anchor-relative full-list indices 2/3', () => {
                const state = { root: [], ungrouped: [] };
                const tree = buildTree({ state });
                const visibleIdentities = [
                    { type: 'source', key: 'A' },
                    { type: 'source', key: 'C' }
                ];

                expect(tree.resolveVisibleAnchorInsertIndex({
                    fullList: filteredEntries,
                    visibleIdentities,
                    anchorIdentity: { type: 'source', key: 'C' },
                    edge: 'before',
                    lastVisiblePolicy: 'anchor-relative'
                })).toBe(2);
                expect(tree.resolveVisibleAnchorInsertIndex({
                    fullList: filteredEntries,
                    visibleIdentities,
                    anchorIdentity: { type: 'source', key: 'C' },
                    edge: 'after',
                    lastVisiblePolicy: 'anchor-relative'
                })).toBe(3);
                expect(tree.resolveVisibleAnchorInsertIndex({
                    fullList: filteredEntries,
                    visibleIdentities,
                    anchorIdentity: { type: 'source', key: 'C' },
                    edge: 'after',
                    lastVisiblePolicy: 'container-end'
                })).toBe(4);
            });

            it('matches visible identities by type plus key/id when source and group identifiers collide', () => {
                const state = { root: [], ungrouped: [] };
                const tree = buildTree({ state });
                const fullList = [
                    { type: 'source', key: 'shared' },
                    { type: 'group', id: 'shared' }
                ];

                expect(tree.resolveVisibleAnchorInsertIndex({
                    fullList,
                    visibleIdentities: [{ type: 'group', id: 'shared' }],
                    anchorIdentity: { type: 'group', id: 'shared' },
                    edge: 'before',
                    lastVisiblePolicy: 'anchor-relative'
                })).toBe(1);
            });

            it('returns 0 for an empty full list and fails closed when a nonempty list has no visible anchor', () => {
                const state = { root: [], ungrouped: [] };
                const tree = buildTree({ state });

                expect(tree.resolveVisibleAnchorInsertIndex({
                    fullList: [],
                    visibleIdentities: [],
                    anchorIdentity: null,
                    edge: 'after',
                    lastVisiblePolicy: 'anchor-relative'
                })).toBe(0);
                expect(tree.resolveVisibleAnchorInsertIndex({
                    fullList: filteredEntries,
                    visibleIdentities: [],
                    anchorIdentity: { type: 'source', key: 'C' },
                    edge: 'after',
                    lastVisiblePolicy: 'anchor-relative'
                })).toBeNull();
            });

            it('aligns active text-search and quick-view source drops after C to underlying index 3', () => {
                const rootIntent = computeFilteredRootIntent({
                    clientY: 175,
                    activeDragContext: { kind: 'source-single', keys: ['external'] }
                });
                const groupIntent = computeFilteredGroupIntent({
                    clientY: 175,
                    activeDragContext: { kind: 'source-single', keys: ['external'] }
                });

                expect(rootIntent).toMatchObject({ kind: 'after-source', slotKey: 'C', insertIndex: 3 });
                expect(groupIntent).toMatchObject({ kind: 'after-source', slotKey: 'C', insertIndex: 3 });
            });

            it('aligns multi-source group-child drops after C to index 3 without changing selection order', () => {
                const activeDragContext = {
                    kind: 'source-multi',
                    keys: ['selected-C', 'selected-A']
                };
                const intent = computeFilteredGroupIntent({ clientY: 175, activeDragContext });

                expect(intent).toMatchObject({ kind: 'after-source', slotKey: 'C', insertIndex: 3 });
                expect(activeDragContext.keys).toEqual(['selected-C', 'selected-A']);
            });

            it('keeps a filtered ungrouped-bin drop after C anchor-relative at index 3', () => {
                const state = {
                    root: [],
                    ungrouped: ['A', 'hidden-B', 'C', 'hidden-D']
                };
                const tree = buildTree({ state });
                const { sourcesListEl } = makeMockShadowList({
                    items: [],
                    ungroupedSection: {
                        bounds: { top: 80, bottom: 200, height: 120 },
                        items: [
                            { key: 'A', top: 100, height: 40 },
                            { key: 'C', top: 140, height: 40 }
                        ]
                    }
                });

                const intent = tree.computeDropIntent({
                    clientX: 100,
                    clientY: 175,
                    rootElement: sourcesListEl,
                    state,
                    groupsById: new Map(),
                    parentMap: new Map(),
                    activeDragContext: {
                        kind: 'source-single',
                        keys: ['external']
                    }
                });

                expect(intent).toMatchObject({
                    kind: 'after-source',
                    slotKey: 'C',
                    insertIndex: 3,
                    isUngroupedBin: true
                });
            });

            it('aligns nested group reorder after visible C to anchor-relative index 3', () => {
                const parent = {
                    id: 'parent',
                    children: [
                        { type: 'group', id: 'A' },
                        { type: 'group', id: 'hidden-B' },
                        { type: 'group', id: 'C' },
                        { type: 'group', id: 'hidden-D' }
                    ]
                };
                const groupsById = new Map([
                    [parent.id, parent],
                    ['A', { id: 'A', children: [{ type: 'source', key: 'a-child' }] }],
                    ['hidden-B', { id: 'hidden-B', children: [] }],
                    ['C', { id: 'C', children: [{ type: 'source', key: 'c-child' }] }],
                    ['hidden-D', { id: 'hidden-D', children: [] }]
                ]);
                const parentMap = new Map([
                    ['A', parent.id],
                    ['hidden-B', parent.id],
                    ['C', parent.id],
                    ['hidden-D', parent.id]
                ]);
                const state = {
                    root: [{ type: 'group', id: parent.id }],
                    ungrouped: []
                };
                const tree = buildTree({ state, groupsById, parentMap });
                const { sourcesListEl } = makeMockShadowList({
                    items: [{
                        kind: 'group',
                        id: parent.id,
                        top: 70,
                        headerHeight: 30,
                        childrenStart: 100,
                        childrenEnd: 250,
                        children: [
                            {
                                kind: 'group',
                                id: 'A',
                                top: 100,
                                headerHeight: 30,
                                childrenStart: 130,
                                childrenEnd: 150,
                                children: [{ kind: 'source', key: 'a-child', top: 130, height: 20 }]
                            },
                            {
                                kind: 'group',
                                id: 'C',
                                top: 160,
                                headerHeight: 30,
                                childrenStart: 190,
                                childrenEnd: 230,
                                children: [{ kind: 'source', key: 'c-child', top: 190, height: 40 }]
                            }
                        ]
                    }]
                });
                const intent = tree.computeDropIntent({
                    clientX: 100,
                    clientY: 210,
                    rootElement: sourcesListEl,
                    state,
                    groupsById,
                    parentMap,
                    activeDragContext: { kind: 'group', draggedGroupId: 'external' }
                });

                expect(intent).toMatchObject({
                    kind: 'after-group',
                    targetList: parent.children,
                    slotKey: 'C',
                    insertIndex: 3
                });
            });

            it('fails closed when filtering leaves no visible anchor in a nonempty container', () => {
                const state = {
                    root: filteredEntries.map((entry) => ({ ...entry })),
                    ungrouped: []
                };
                const tree = buildTree({ state });
                const { sourcesListEl } = makeMockShadowList({ items: [] });

                expect(tree.computeDropIntent({
                    clientY: 150,
                    rootElement: sourcesListEl,
                    state,
                    groupsById: new Map(),
                    parentMap: new Map(),
                    activeDragContext: { kind: 'source-single', keys: ['external'] }
                })).toBeNull();
            });
        });
    });

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
        expect(intent.target).toEqual({
            container: 'root',
            index: 1
        });
    });

    it('distinguishes same-layer source and group slots with the same raw identifier', () => {
        const state = {
            root: [
                { type: 'source', key: 'shared' },
                { type: 'group', id: 'shared' }
            ],
            ungrouped: []
        };
        const groupsById = new Map([['shared', {
            id: 'shared',
            collapsed: true,
            children: []
        }]]);
        const tree = buildTree({ state, groupsById });
        const { sourcesListEl } = makeMockShadowList({
            items: [
                { kind: 'source', key: 'shared', top: 100, height: 40 },
                {
                    kind: 'group',
                    id: 'shared',
                    top: 140,
                    headerHeight: 30,
                    childrenStart: 170,
                    childrenEnd: 170
                }
            ]
        });
        const args = {
            rootElement: sourcesListEl,
            state,
            groupsById,
            parentMap: new Map(),
            activeDragContext: {
                kind: 'group',
                draggedGroupId: 'external'
            }
        };

        const sourceIntent = tree.computeDropIntent({
            ...args,
            clientX: 100,
            clientY: 105
        });
        const groupIntent = tree.computeDropIntent({
            ...args,
            clientX: 100,
            clientY: 135
        });

        expect(sourceIntent).toMatchObject({
            kind: 'before-source',
            slotKey: 'shared',
            insertIndex: 0
        });
        expect(groupIntent).toMatchObject({
            kind: 'before-group',
            slotKey: 'shared',
            insertIndex: 1
        });
    });

    it('classic mode: a source dropped at a root position is demoted to the ungrouped bin', () => {
        const state = { root: [{ type: 'group', id: 'g1' }, { type: 'group', id: 'g2' }], ungrouped: [] };
        const groupsById = new Map([['g1', { id: 'g1', children: [] }], ['g2', { id: 'g2', children: [] }]]);
        const tree = createContentTreeInteractions({
            getState: () => state,
            getGroupsById: () => groupsById,
            getParentMap: () => new Map(),
            getDragMode: () => 'classic'
        });
        const { sourcesListEl } = makeMockShadowList({
            items: [
                { kind: 'group', id: 'g1', top: 100, headerHeight: 30, childrenStart: 130, childrenEnd: 130 },
                { kind: 'group', id: 'g2', top: 200, headerHeight: 30, childrenStart: 230, childrenEnd: 230 }
            ]
        });
        // pointer in the gap between g1 and g2 — a source landing here is a root position
        const intent = tree.computeDropIntent({
            clientY: 150,
            rootElement: sourcesListEl,
            state,
            groupsById,
            parentMap: new Map(),
            activeDragContext: { kind: 'source-single', keys: ['X'] }
        });
        expect(intent).toBeTruthy();
        expect(intent.isRootList).toBeFalsy();
        expect(intent.targetList).toBe(state.ungrouped);
        expect(intent.isUngroupedBin).toBe(true);
        expect(intent.insertIndex).toBe(0);
        expect(intent.target).toEqual({
            container: 'ungrouped',
            index: 0
        });
    });

    it('reflow mode: the same root-position source drop stays a positioned root intent', () => {
        const state = { root: [{ type: 'group', id: 'g1' }, { type: 'group', id: 'g2' }], ungrouped: [] };
        const groupsById = new Map([['g1', { id: 'g1', children: [] }], ['g2', { id: 'g2', children: [] }]]);
        const tree = createContentTreeInteractions({
            getState: () => state,
            getGroupsById: () => groupsById,
            getParentMap: () => new Map(),
            getDragMode: () => 'reflow'
        });
        const { sourcesListEl } = makeMockShadowList({
            items: [
                { kind: 'group', id: 'g1', top: 100, headerHeight: 30, childrenStart: 130, childrenEnd: 130 },
                { kind: 'group', id: 'g2', top: 200, headerHeight: 30, childrenStart: 230, childrenEnd: 230 }
            ]
        });
        const intent = tree.computeDropIntent({
            clientY: 150,
            rootElement: sourcesListEl,
            state,
            groupsById,
            parentMap: new Map(),
            activeDragContext: { kind: 'source-single', keys: ['X'] }
        });
        expect(intent).toBeTruthy();
        expect(intent.isRootList).toBe(true);
        expect(intent.targetList).toBe(state.root);
        expect(intent.isUngroupedBin).toBeFalsy();
    });

    it('classic mode: a source dropped INTO a folder is not demoted (into-group preserved)', () => {
        const state = { root: [{ type: 'group', id: 'g1' }], ungrouped: [] };
        const groupsById = new Map([
            ['g1', { id: 'g1', collapsed: false, children: [{ type: 'source', key: 'c1' }] }]
        ]);
        const tree = createContentTreeInteractions({
            getState: () => state,
            getGroupsById: () => groupsById,
            getParentMap: () => new Map(),
            getDragMode: () => 'classic'
        });
        const { sourcesListEl } = makeMockShadowList({
            items: [
                {
                    kind: 'group', id: 'g1', top: 100, headerHeight: 40,
                    childrenStart: 140, childrenEnd: 180,
                    children: [{ kind: 'source', key: 'c1', top: 140, height: 40 }]
                }
            ]
        });
        // pointer on the header (y=110) → into-group, has targetGroup, not isRootList
        const intent = tree.computeDropIntent({
            clientX: 100,
            clientY: 110,
            rootElement: sourcesListEl,
            state,
            groupsById,
            parentMap: new Map(),
            activeDragContext: { kind: 'source-single', keys: ['X'] }
        });
        expect(intent).toBeTruthy();
        expect(intent.targetGroup).toBe(groupsById.get('g1'));
        expect(intent.isUngroupedBin).toBeFalsy();
        expect(intent.target).toEqual({
            container: 'group',
            groupId: 'g1',
            index: 0
        });
    });

    it('classic mode: a GROUP reordered at root is not demoted (groups still reorder)', () => {
        const state = { root: [{ type: 'group', id: 'g1' }, { type: 'group', id: 'g2' }], ungrouped: [] };
        const groupsById = new Map([['g1', { id: 'g1', children: [] }], ['g2', { id: 'g2', children: [] }]]);
        const tree = createContentTreeInteractions({
            getState: () => state,
            getGroupsById: () => groupsById,
            getParentMap: () => new Map(),
            getDragMode: () => 'classic'
        });
        const { sourcesListEl } = makeMockShadowList({
            items: [
                { kind: 'group', id: 'g1', top: 100, headerHeight: 30, childrenStart: 130, childrenEnd: 130 },
                { kind: 'group', id: 'g2', top: 200, headerHeight: 30, childrenStart: 230, childrenEnd: 230 }
            ]
        });
        const intent = tree.computeDropIntent({
            clientY: 150,
            rootElement: sourcesListEl,
            state,
            groupsById,
            parentMap: new Map(),
            activeDragContext: { kind: 'group', draggedGroupId: 'g2' }
        });
        expect(intent).toBeTruthy();
        expect(intent.isUngroupedBin).toBeFalsy();
        expect(intent.targetList).toBe(state.root);
    });

    it('returns a before-source intent into an expanded folder when cursor is between its two children', () => {
        const state = { root: [{ type: 'group', id: 'g1' }], ungrouped: [] };
        const groupsById = new Map([
            ['g1', { id: 'g1', collapsed: false, children: [{ type: 'source', key: 'c1' }, { type: 'source', key: 'c2' }] }]
        ]);
        const tree = buildTree({ state, groupsById });
        const { sourcesListEl } = makeMockShadowList({
            items: [
                {
                    kind: 'group', id: 'g1', top: 100, headerHeight: 40,
                    childrenStart: 140, childrenEnd: 220,
                    children: [
                        { kind: 'source', key: 'c1', top: 140, height: 40 },
                        { kind: 'source', key: 'c2', top: 180, height: 40 }
                    ]
                }
            ]
        });
        const intent = tree.computeDropIntent({
            clientX: 100,
            clientY: 185,
            rootElement: sourcesListEl,
            state,
            groupsById,
            parentMap: new Map(),
            activeDragContext: { kind: 'source-single', keys: ['X'] }
        });
        expect(intent).toBeTruthy();
        expect(intent.targetGroup).toBe(groupsById.get('g1'));
        expect(intent.targetList).toBe(groupsById.get('g1').children);
        expect(intent.kind).toBe('before-source');
        expect(intent.slotKey).toBe('c2');
        expect(intent.insertIndex).toBe(1);
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

    function setupTreeInteractionsTestContext({
        state,
        pendingBatchKeys,
        groups,
        parentMap,
        items,
        saveState
    }) {
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
            dragMulti,
            saveState
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

    it('cancels a pending collapsed-folder expand when the next frame has no intent', () => {
        const ctx = setupTreeInteractionsTestContext({
            state: { isBatchMode: false, ungrouped: [], groups: ['g1'] },
            pendingBatchKeys: new Set(),
            groups: {
                g1: {
                    id: 'g1',
                    children: [{ type: 'source', key: 'X' }],
                    collapsed: true
                }
            },
            items: [{
                kind: 'group',
                id: 'g1',
                top: 100,
                headerHeight: 40,
                childrenStart: 140,
                childrenEnd: 140
            }]
        });
        ctx.runtime.activeDragContext = { kind: 'source-single', keys: ['Y'] };
        ctx.helpers.dragOverFor('g1');
        expect(ctx.runtime.hoverExpandTimers.get('g1')).toMatchObject({ kind: 'expand' });

        ctx.tree.handleDragOver({
            target: { closest: () => null },
            clientX: 100,
            clientY: 1200,
            preventDefault: jest.fn(),
            dataTransfer: { dropEffect: 'move' }
        });

        expect(ctx.runtime.hoverExpandTimers.has('g1')).toBe(false);
        jest.advanceTimersByTime(1000);
        expect(ctx.groupsById.get('g1').collapsed).toBe(true);
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

    it('restores and saves an interrupted hover-open group before the next drag starts', () => {
        const saveState = jest.fn();
        const ctx = setupTreeInteractionsTestContext({
            state: {
                isBatchMode: false,
                root: [{ type: 'group', id: 'g1' }],
                ungrouped: ['A']
            },
            pendingBatchKeys: new Set(),
            groups: {
                g1: {
                    id: 'g1',
                    children: [{ type: 'source', key: 'X' }],
                    collapsed: false
                }
            },
            items: [
                {
                    kind: 'group',
                    id: 'g1',
                    top: 100,
                    headerHeight: 40,
                    childrenStart: 140,
                    childrenEnd: 200
                },
                { kind: 'source', key: 'A', top: 220, height: 40 }
            ],
            saveState
        });
        ctx.runtime.hoverExpandedGroupIds.add('g1');
        const source = ctx.elementMap.get('source:A');

        ctx.tree.handleDragStart({
            target: {
                closest: (selector) => {
                    if (selector === '.source-item') return source;
                    if (selector === '.group-header') return null;
                    return null;
                }
            },
            dataTransfer: {
                setData: jest.fn(),
                setDragImage: jest.fn(),
                effectAllowed: ''
            }
        });

        expect(ctx.groupsById.get('g1').collapsed).toBe(true);
        expect(ctx.runtime.hoverExpandedGroupIds.size).toBe(0);
        expect(saveState).toHaveBeenCalledTimes(1);
        expect(saveState).toHaveBeenCalledWith({ immediate: true });
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

    it('settles the opened folder children to drag-ready (height:auto, overflow:visible) so reflow is not clipped mid-drag', () => {
        const ctx = setupTreeInteractionsTestContext({
            state: { isBatchMode: false, ungrouped: [], groups: ['g1'] },
            pendingBatchKeys: new Set(),
            groups: { g1: { id: 'g1', children: [{ type: 'source', key: 'X' }], collapsed: true } },
            items: [{ kind: 'group', id: 'g1', top: 100, headerHeight: 40, childrenStart: 140, childrenEnd: 140 }]
        });
        const container = ctx.elementMap.get('group:g1');
        const childrenEl = container.querySelector('.group-children');
        // Simulate the animated-open window left by toggleGroupCollapse: the children
        // container is clamped to a fixed pixel height with overflow:hidden until an
        // async transitionend would restore it. A drag-reflow translateY would be clipped.
        childrenEl.style.overflow = 'hidden';
        childrenEl.style.height = '80px';

        ctx.helpers.dragOverFor('g1');
        jest.advanceTimersByTime(1000);

        expect(ctx.groupsById.get('g1').collapsed).toBe(false);
        // Hover-expand must leave the folder immediately drag-ready, NOT wait for transitionend.
        expect(childrenEl.style.overflow).toBe('visible');
        expect(childrenEl.style.height).toBe('auto');
    });

    it('keeps a restored hover-open folder collapsed after stale transitionend events', () => {
        const ctx = setupTreeInteractionsTestContext({
            state: { isBatchMode: false, ungrouped: [], groups: ['g1'] },
            pendingBatchKeys: new Set(),
            groups: {
                g1: {
                    id: 'g1',
                    children: [{ type: 'source', key: 'X' }],
                    collapsed: true
                }
            },
            items: [{
                kind: 'group',
                id: 'g1',
                top: 100,
                headerHeight: 40,
                childrenStart: 140,
                childrenEnd: 180
            }]
        });
        const container = ctx.elementMap.get('group:g1');
        const childrenEl = container.querySelector('.group-children');

        ctx.helpers.dragOverFor('g1');
        jest.advanceTimersByTime(1000);
        expect(childrenEl.style.height).toBe('auto');
        expect(childrenEl.style.overflow).toBe('visible');

        ctx.tree.handleDragEnd({ target: { closest: () => null } });
        expect(ctx.groupsById.get('g1').collapsed).toBe(true);
        expect(childrenEl.classList.contains('collapsed')).toBe(true);
        expect(childrenEl.style.height).toBe('');
        expect(childrenEl.style.overflow).toBe('');

        childrenEl.dispatchEvent({
            type: 'transitionend',
            propertyName: 'opacity',
            target: childrenEl
        });
        childrenEl.dispatchEvent({
            type: 'transitionend',
            propertyName: 'height',
            target: childrenEl
        });

        expect(childrenEl.classList.contains('collapsed')).toBe(true);
        expect(childrenEl.style.height).toBe('');
        expect(childrenEl.style.overflow).toBe('');
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
                state: {
                    isBatchMode: false,
                    root: [{ type: 'group', id: 'g1' }],
                    ungrouped: ['A']
                },
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
                    insertIndex: 1,
                    targetGroupId: 'g1',
                    hostGroupContainerEl: ctx.elementMap.get('group:g1'),
                    slotKey: null,
                    target: {
                        container: 'group',
                        groupId: 'g1',
                        index: 1
                    }
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
                state: {
                    isBatchMode: false,
                    root: [
                        { type: 'group', id: 'g1' },
                        { type: 'group', id: 'g2' }
                    ],
                    ungrouped: ['A']
                },
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
                    insertIndex: 0,
                    targetGroupId: 'g2',
                    hostGroupContainerEl: ctx.elementMap.get('group:g2'),
                    slotKey: null,
                    target: {
                        container: 'group',
                        groupId: 'g2',
                        index: 0
                    }
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
                slotKey: 'source-2',
                isUngroupedBin: true,
                target: {
                    container: 'ungrouped',
                    index: 2
                }
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
                slotKey: 'source-2',
                isUngroupedBin: true,
                target: {
                    container: 'ungrouped',
                    index: 2
                }
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

    it('keeps source and group FLIP snapshots separate when their raw ids match', () => {
        const state = {
            root: [
                { type: 'source', key: 'mover' },
                { type: 'source', key: 'shared' },
                { type: 'group', id: 'shared' }
            ],
            ungrouped: []
        };
        const group = { id: 'shared', children: [] };
        let rendered = false;
        const createRow = ({ type, key, beforeTop, afterTop }) => {
            const transformWrites = [];
            const style = { transition: '' };
            Object.defineProperty(style, 'transform', {
                get() { return this._transform || ''; },
                set(value) {
                    transformWrites.push(value);
                    this._transform = value;
                }
            });
            return {
                dataset: type === 'source'
                    ? { sourceKey: key }
                    : { groupId: key },
                classList: createClassList([
                    type === 'source' ? 'source-item' : 'group-container'
                ]),
                style,
                offsetHeight: 40,
                transformWrites,
                getBoundingClientRect: () => {
                    const top = rendered ? afterTop : beforeTop;
                    return {
                        top,
                        bottom: top + 40,
                        left: 0,
                        right: 200,
                        width: 200,
                        height: 40
                    };
                }
            };
        };
        const mover = createRow({
            type: 'source',
            key: 'mover',
            beforeTop: 100,
            afterTop: 180
        });
        const sourceShared = createRow({
            type: 'source',
            key: 'shared',
            beforeTop: 140,
            afterTop: 100
        });
        const groupShared = createRow({
            type: 'group',
            key: 'shared',
            beforeTop: 180,
            afterTop: 140
        });
        const rows = [mover, sourceShared, groupShared];
        const sourcesListEl = {
            id: 'sources-list',
            querySelectorAll: jest.fn((selector) => (
                selector.includes('[data-source-key]')
                    ? rows
                    : []
            )),
            querySelector: jest.fn((selector) => {
                if (selector === '[data-source-key="mover"]') return mover;
                return null;
            })
        };
        const shadowRoot = {
            querySelector: jest.fn(() => null),
            querySelectorAll: jest.fn(() => []),
            getElementById: jest.fn((id) => (
                id === 'sources-list' ? sourcesListEl : null
            ))
        };
        const session = {
            draggedKeys: new Set(['mover']),
            currentIntent: {
                kind: 'after-group',
                targetGroup: null,
                targetList: state.root,
                insertIndex: 3,
                targetGroupId: null,
                slotKey: 'shared',
                isRootList: true,
                target: {
                    container: 'root',
                    index: 3
                }
            },
            shiftedItems: new Map()
        };
        const dragReflow = makeDragReflowMock();
        const treePlacement = {
            applyPlacement: jest.fn(() => ({
                ok: true,
                changed: true,
                reason: 'moved',
                to: { container: 'root', index: 2 }
            })),
            rebuildParentMap: jest.fn()
        };
        const interactions = createContentTreeInteractions({
            runtime: { dragReflowSession: session },
            treePlacement,
            getState: () => state,
            getGroupsById: () => new Map([['shared', group]]),
            getParentMap: () => new Map(),
            getShadowRoot: () => shadowRoot,
            saveState: jest.fn(),
            render: jest.fn(() => { rendered = true; }),
            dragMulti: createContentDragMulti({}),
            dragReflow
        });

        interactions.handleDrop(createDropEvent({
            dropTarget: groupShared,
            sourceKey: 'mover'
        }));

        expect(sourceShared.transformWrites).toEqual([
            'translateY(40px)',
            ''
        ]);
        expect(groupShared.transformWrites).toEqual([
            'translateY(40px)',
            ''
        ]);
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

    it('replays typed shifts statically until fresh post-render geometry is available', () => {
        const createContentDragReflow = require('../../src/content/content-drag-reflow.js');
        const dragReflow = createContentDragReflow({});
        const makeRow = (key) => ({
            style: {},
            classList: makeMockClassList(['source-item']),
            dataset: { sourceKey: key },
            getAttribute: (name) => (name === 'data-source-key' ? key : null)
        });
        const rows = { B: makeRow('B'), C: makeRow('C') };
        const container = {
            querySelectorAll: jest.fn(() => [rows.B, rows.C]),
            querySelector: jest.fn(() => {
                throw new Error('typed render replay must not use selector fallback');
            }),
            contains: (element) => element === rows.B || element === rows.C
        };
        rows.B.parentElement = container;
        rows.C.parentElement = container;
        const shadowRoot = {
            querySelector: () => null,
            querySelectorAll: () => [],
            getElementById: (id) => (id === 'sources-list' ? container : null)
        };
        const session = dragReflow.createDragSession();
        session.draggedKeys = new Set(['A']);
        session.totalDraggedHeight = 40;
        session.shiftedSourceItems = new Map([
            ['B', 40],
            ['C', 40]
        ]);
        session.animatedShiftedSourceItems = new Set(['B']);
        session.staticShiftClassSourceItems = new Set(['C']);
        session.usesScopedShiftClasses = true;
        const runtime = {
            activeDragContext: { kind: 'source-single', keys: ['A'] },
            dragReflowSession: session
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
        expect(rows.B.classList.contains('sp-drop-shift')).toBe(false);
        expect(rows.C.classList.contains('sp-drop-shift')).toBe(false);
        expect(rows.B.classList.contains('sp-drop-shift-static')).toBe(true);
        expect(rows.C.classList.contains('sp-drop-shift-static')).toBe(true);
        expect(session.animatedShiftedSourceItems).toEqual(new Set());
        expect(session.staticShiftClassSourceItems).toEqual(new Set(['B', 'C']));
        expect(session.usesScopedShiftClasses).toBe(true);
        expect(container.querySelector).not.toHaveBeenCalled();
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
        const origQSA = base.querySelectorAll.bind(base);
        base.querySelector = (sel) => {
            if (sel === '.sp-ungroup-dropzone') {
                return appended.find((n) => n.classList && n.classList.contains('sp-ungroup-dropzone')) || null;
            }
            return origQS(sel);
        };
        base.querySelectorAll = (sel) => {
            const result = Array.from(origQSA(sel));
            if (sel.includes('.sp-ungroup-dropzone')) result.push(...appended);
            return result;
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
                    getBoundingClientRect: () => ({
                        top: 940, bottom: 980, left: 0, right: 200, width: 200, height: 40
                    }),
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

describe('single-frame drag geometry snapshot budgets', () => {
    let createContentTreeInteractions;

    function createTrackedClassList(initial, onWrite) {
        const classes = new Set(initial);
        return {
            add: jest.fn((...names) => {
                onWrite();
                names.forEach((name) => classes.add(name));
            }),
            remove: jest.fn((...names) => {
                onWrite();
                names.forEach((name) => classes.delete(name));
            }),
            contains: (name) => classes.has(name),
            has: (name) => classes.has(name)
        };
    }

    function createGeometryFixture(rowCount) {
        let writeStarted = false;
        const rectReads = new Map();
        const listeners = new Map();
        const sources = [];
        const sourceByKey = new Map();
        const markWrite = () => { writeStarted = true; };
        const readRect = (name, rect) => {
            if (writeStarted) {
                throw new Error(`geometry read after first write: ${name}`);
            }
            rectReads.set(name, (rectReads.get(name) || 0) + 1);
            return { ...rect };
        };
        const root = {
            id: 'sources-list',
            style: {},
            dataset: {},
            scrollTop: 0,
            scrollLeft: 0,
            classList: createTrackedClassList([], markWrite),
            querySelector: jest.fn((selector) => {
                if (writeStarted) {
                    throw new Error(`selector read after first write: ${selector}`);
                }
                if (selector === '.ungrouped-section' || selector === '.sp-ungroup-dropzone') return null;
                const sourceMatch = /\[data-source-key="([^"]+)"\]/.exec(selector);
                if (sourceMatch) return sourceByKey.get(sourceMatch[1]) || null;
                return null;
            }),
            querySelectorAll: jest.fn((selector) => {
                if (
                    selector === '.source-item[data-source-key], .group-container[data-group-id], .group-header, .group-children, .ungrouped-section, .sp-ungroup-dropzone'
                ) {
                    return sources.slice();
                }
                if (selector === ':scope > .group-container, :scope > .source-item') {
                    return sources.slice();
                }
                return [];
            }),
            getBoundingClientRect: jest.fn(() => readRect('root', {
                top: 0,
                bottom: 1000,
                left: 0,
                right: 240,
                width: 240,
                height: 1000
            })),
            contains: (element) => element === root || sources.includes(element),
            addEventListener: jest.fn((type, listener) => {
                listeners.set(type, listener);
            }),
            removeEventListener: jest.fn((type, listener) => {
                if (listeners.get(type) === listener) listeners.delete(type);
            }),
            appendChild: jest.fn(markWrite),
            removeChild: jest.fn(markWrite)
        };
        for (let index = 0; index < rowCount; index += 1) {
            const key = `source-${index}`;
            const top = 100 + index * 40;
            const source = {
                dataset: { sourceKey: key },
                style: { transform: '' },
                parentElement: root,
                classList: createTrackedClassList(['source-item'], markWrite),
                getAttribute: (name) => (name === 'data-source-key' ? key : null),
                getBoundingClientRect: jest.fn(() => readRect(key, {
                    top,
                    bottom: top + 40,
                    left: 0,
                    right: 200,
                    width: 200,
                    height: 40
                }))
            };
            sources.push(source);
            sourceByKey.set(key, source);
        }
        sources.forEach((source, index) => {
            source.nextElementSibling = sources[index + 1] || null;
        });
        root.children = sources;
        return {
            root,
            sources,
            rectReads,
            listeners,
            resetWritePhase() { writeStarted = false; },
            didWrite() { return writeStarted; }
        };
    }

    function createNestedFixture() {
        let writeStarted = false;
        const rectReads = new Map();
        const listeners = new Map();
        const markWrite = () => { writeStarted = true; };
        const makeRectReader = (name, rect) => jest.fn(() => {
            if (writeStarted) throw new Error(`geometry read after first write: ${name}`);
            rectReads.set(name, (rectReads.get(name) || 0) + 1);
            return { ...rect };
        });
        const root = {
            id: 'sources-list',
            style: {},
            scrollTop: 0,
            scrollLeft: 0,
            classList: createTrackedClassList([], markWrite),
            getBoundingClientRect: makeRectReader('root', {
                top: 0, bottom: 500, left: 0, right: 240, width: 240, height: 500
            }),
            addEventListener: jest.fn((type, listener) => {
                listeners.set(type, listener);
            }),
            removeEventListener: jest.fn((type, listener) => {
                if (listeners.get(type) === listener) listeners.delete(type);
            })
        };
        const group = {
            dataset: { groupId: 'same-key' },
            style: { transform: '' },
            parentElement: root,
            classList: createTrackedClassList(['group-container'], markWrite),
            getAttribute: (name) => (name === 'data-group-id' ? 'same-key' : null),
            getBoundingClientRect: makeRectReader('group', {
                top: 100, bottom: 180, left: 0, right: 200, width: 200, height: 80
            })
        };
        const header = {
            style: {},
            parentElement: group,
            classList: createTrackedClassList(['group-header'], markWrite),
            getBoundingClientRect: makeRectReader('header', {
                top: 100, bottom: 140, left: 0, right: 200, width: 200, height: 40
            })
        };
        const children = {
            scrollTop: 0,
            scrollLeft: 0,
            style: {
                setProperty: jest.fn(markWrite),
                removeProperty: jest.fn(markWrite)
            },
            parentElement: group,
            classList: createTrackedClassList(['group-children'], markWrite),
            getBoundingClientRect: makeRectReader('children', {
                top: 140, bottom: 180, left: 0, right: 200, width: 200, height: 40
            })
        };
        const source = {
            dataset: { sourceKey: 'same-key' },
            style: { transform: '' },
            parentElement: children,
            classList: createTrackedClassList(['source-item'], markWrite),
            getAttribute: (name) => (name === 'data-source-key' ? 'same-key' : null),
            getBoundingClientRect: makeRectReader('source', {
                top: 140, bottom: 180, left: 0, right: 200, width: 200, height: 40
            })
        };
        root.children = [group];
        group.children = [header, children];
        children.children = [source];
        root.contains = (element) => [root, group, header, children, source].includes(element);
        root.querySelectorAll = jest.fn((selector) => {
            if (
                selector === '.source-item[data-source-key], .group-container[data-group-id], .group-header, .group-children, .ungrouped-section, .sp-ungroup-dropzone'
            ) {
                return [group, header, children, source];
            }
            if (selector === ':scope > .group-container, :scope > .source-item') return [group];
            if (selector === '.group-container') return [group];
            return [];
        });
        root.querySelector = jest.fn((selector) => {
            if (selector === '.ungrouped-section' || selector === '.sp-ungroup-dropzone') return null;
            if (selector.includes('data-group-id')) return group;
            if (selector.includes('data-source-key')) return source;
            return null;
        });
        group.querySelector = jest.fn((selector) => {
            if (selector === '.group-header') return header;
            if (selector === '.group-children') return children;
            return null;
        });
        children.querySelectorAll = jest.fn(() => [source]);
        return {
            root,
            group,
            header,
            children,
            source,
            rectReads,
            listeners,
            resetWritePhase() { writeStarted = false; }
        };
    }

    function buildTree({
        fixture,
        runtime = {},
        state,
        groupsById,
        getSetTimeout,
        dragReflow = null,
        extraDeps = {}
    } = {}) {
        const resolvedState = state || {
            root: fixture.sources
                ? fixture.sources.map((source) => ({ type: 'source', key: source.dataset.sourceKey }))
                : [{ type: 'group', id: 'same-key' }],
            ungrouped: []
        };
        const resolvedGroups = groupsById || new Map();
        const shadowRoot = {
            getElementById: (id) => (id === 'sources-list' ? fixture.root : null),
            querySelector: (selector) => fixture.root.querySelector(selector),
            querySelectorAll: () => []
        };
        return createContentTreeInteractions({
            runtime,
            getState: () => resolvedState,
            getGroupsById: () => resolvedGroups,
            getParentMap: () => new Map(),
            getShadowRoot: () => shadowRoot,
            getDocument: () => null,
            getSetTimeout: getSetTimeout || (() => () => 1),
            dragMulti: null,
            dragReflow,
            ...extraDeps
        });
    }

    beforeEach(() => {
        jest.resetModules();
        setupGlobalMocks();
        require('../../src/content/content-native-checkbox-sync.js');
        createContentTreeInteractions = require('../../src/content/content-tree-interactions.js');
    });

    afterEach(teardownGlobalMocks);

    it('exports the read-plan-write and invalidation interfaces', () => {
        const tree = createContentTreeInteractions({});
        expect(tree.readDragGeometry).toBeInstanceOf(Function);
        expect(tree.computeDropIntentRaw).toBeInstanceOf(Function);
        expect(tree.planDragFrame).toBeInstanceOf(Function);
        expect(tree.applyDragFramePlan).toBeInstanceOf(Function);
        expect(tree.resolveSynchronousDropEffect).toBeInstanceOf(Function);
        expect(tree.invalidateDragGeometry).toBeInstanceOf(Function);
        expect(tree.flushDragFrameNow).toBeInstanceOf(Function);
    });

    it.each([100, 500])('reads %i rows with one query batch and one rect read per element', (rowCount) => {
        const fixture = createGeometryFixture(rowCount);
        const runtime = {};
        const tree = buildTree({ fixture, runtime });

        tree.invalidateDragGeometry('test_prime', { schedule: false });
        const snapshot = tree.readDragGeometry({
            rootElement: fixture.root,
            session: null
        });

        expect(snapshot).toBeTruthy();
        expect(fixture.root.querySelectorAll).toHaveBeenCalledTimes(1);
        expect(fixture.root.getBoundingClientRect).toHaveBeenCalledTimes(1);
        fixture.sources.forEach((source) => {
            expect(source.getBoundingClientRect).toHaveBeenCalledTimes(1);
        });
        expect(runtime.dragGeometryDirty).toBe(false);
    });

    it('patches a clean snapshot for pure root viewport translation without rereading rows', () => {
        const fixture = createGeometryFixture(2);
        const runtime = {};
        const tree = buildTree({ fixture, runtime });
        const snapshot = tree.readDragGeometry({
            rootElement: fixture.root,
            session: null
        });
        const beforeVisualTop = snapshot.sourceEntries.get('source-0').visualRect.top;
        const beforeLayoutTop = snapshot.sourceEntries.get('source-0').layoutRect.top;
        fixture.root.getBoundingClientRect.mockImplementation(() => ({
            top: 30,
            bottom: 1030,
            left: 15,
            right: 255,
            width: 240,
            height: 1000
        }));

        const translated = tree.readDragGeometry({
            rootElement: fixture.root,
            session: null
        });

        expect(translated).toBe(snapshot);
        expect(fixture.root.getBoundingClientRect).toHaveBeenCalledTimes(2);
        expect(fixture.root.querySelectorAll).toHaveBeenCalledTimes(1);
        fixture.sources.forEach((source) => {
            expect(source.getBoundingClientRect).toHaveBeenCalledTimes(1);
        });
        expect(translated.sourceEntries.get('source-0').visualRect.top).toBe(
            beforeVisualTop + 30
        );
        expect(translated.sourceEntries.get('source-0').layoutRect.top).toBe(
            beforeLayoutTop + 30
        );
        expect(translated.sourceEntries.get('source-0').visualRect.left).toBe(15);
        expect(runtime.dragGeometryDirty).toBe(false);
    });

    it('patches every cached visual and layout rect from an exact root scroll delta', () => {
        const fixture = createGeometryFixture(2);
        const runtime = {};
        const tree = buildTree({ fixture, runtime });
        tree.handleDragStart({
            target: {
                closest: (selector) => (
                    selector === '.source-item' ? fixture.sources[0] : null
                )
            },
            dataTransfer: {
                setData: jest.fn(),
                effectAllowed: ''
            }
        });
        fixture.resetWritePhase();
        const snapshot = tree.readDragGeometry({
            rootElement: fixture.root,
            session: null
        });
        const before = Array.from(snapshot.sourceEntries.values()).map((entry) => ({
            visualTop: entry.visualRect.top,
            visualLeft: entry.visualRect.left,
            layoutTop: entry.layoutRect.top,
            layoutLeft: entry.layoutRect.left
        }));
        const geometryQueryCount = fixture.root.querySelectorAll.mock.calls.length;
        const rootRectReadCount = fixture.root.getBoundingClientRect.mock.calls.length;
        const scrollListener = fixture.listeners.get('scroll');

        fixture.root.scrollTop = 24;
        fixture.root.scrollLeft = 7;
        scrollListener({ target: fixture.root });
        fixture.resetWritePhase();
        const patched = tree.readDragGeometry({
            rootElement: fixture.root,
            session: null
        });

        expect(patched).toBe(snapshot);
        expect(fixture.root.querySelectorAll).toHaveBeenCalledTimes(geometryQueryCount);
        expect(fixture.root.getBoundingClientRect).toHaveBeenCalledTimes(rootRectReadCount + 1);
        fixture.sources.forEach((source) => {
            expect(source.getBoundingClientRect).toHaveBeenCalledTimes(1);
        });
        Array.from(patched.sourceEntries.values()).forEach((entry, index) => {
            expect(entry.visualRect.top).toBe(before[index].visualTop - 24);
            expect(entry.visualRect.left).toBe(before[index].visualLeft - 7);
            expect(entry.layoutRect.top).toBe(before[index].layoutTop - 24);
            expect(entry.layoutRect.left).toBe(before[index].layoutLeft - 7);
        });
        expect(runtime.dragGeometryDirty).toBe(false);
    });

    it.each(['callback-first', 'native-first'])(
        'records an auto-scroll delta once when %s notification wins the race',
        (notificationOrder) => {
            const fixture = createGeometryFixture(2);
            const runtime = {};
            let onDidScroll = null;
            const dragMulti = {
                createAutoScrollController: jest.fn((options) => {
                    onDidScroll = options.onDidScroll;
                    return {
                        tick: jest.fn(),
                        stop: jest.fn()
                    };
                })
            };
            const tree = buildTree({
                fixture,
                runtime,
                extraDeps: { dragMulti }
            });
            tree.handleDragStart({
                target: {
                    closest: (selector) => (
                        selector === '.source-item' ? fixture.sources[0] : null
                    )
                },
                dataTransfer: {
                    setData: jest.fn(),
                    effectAllowed: ''
                }
            });
            fixture.resetWritePhase();
            const snapshot = tree.readDragGeometry({
                rootElement: fixture.root,
                session: null
            });
            const beforeTop = snapshot.sourceEntries.get('source-0').visualRect.top;
            const geometryQueryCount = fixture.root.querySelectorAll.mock.calls.length;
            const scrollListener = fixture.listeners.get('scroll');
            const notifyAutoScroll = () => onDidScroll({
                container: fixture.root,
                before: 0,
                after: 40,
                velocity: 10
            });
            const notifyNativeScroll = () => scrollListener({ target: fixture.root });

            fixture.root.scrollTop = 40;
            if (notificationOrder === 'callback-first') {
                notifyAutoScroll();
                notifyNativeScroll();
            } else {
                notifyNativeScroll();
                notifyAutoScroll();
            }
            fixture.resetWritePhase();
            const patched = tree.readDragGeometry({
                rootElement: fixture.root,
                session: null
            });

            expect(patched).toBe(snapshot);
            expect(patched.sourceEntries.get('source-0').visualRect.top).toBe(
                beforeTop - 40
            );
            expect(fixture.root.querySelectorAll).toHaveBeenCalledTimes(
                geometryQueryCount
            );
            fixture.sources.forEach((source) => {
                expect(source.getBoundingClientRect).toHaveBeenCalledTimes(1);
            });
            expect(runtime.dragGeometryDirty).toBe(false);
        }
    );

    it('combines a root viewport translation with the pending root scroll delta', () => {
        const fixture = createGeometryFixture(1);
        const runtime = {};
        const tree = buildTree({ fixture, runtime });
        tree.handleDragStart({
            target: {
                closest: (selector) => (
                    selector === '.source-item' ? fixture.sources[0] : null
                )
            },
            dataTransfer: {
                setData: jest.fn(),
                effectAllowed: ''
            }
        });
        fixture.resetWritePhase();
        const snapshot = tree.readDragGeometry({
            rootElement: fixture.root,
            session: null
        });
        const source = snapshot.sourceEntries.get('source-0');
        const before = {
            visualTop: source.visualRect.top,
            visualLeft: source.visualRect.left,
            layoutTop: source.layoutRect.top,
            layoutLeft: source.layoutRect.left
        };
        const geometryQueryCount = fixture.root.querySelectorAll.mock.calls.length;
        const rootRectReadCount = fixture.root.getBoundingClientRect.mock.calls.length;
        fixture.root.getBoundingClientRect.mockImplementation(() => ({
            top: 30,
            bottom: 1030,
            left: 15,
            right: 255,
            width: 240,
            height: 1000
        }));

        fixture.root.scrollTop = 24;
        fixture.root.scrollLeft = 7;
        fixture.listeners.get('scroll')({ target: fixture.root });
        fixture.resetWritePhase();
        const patched = tree.readDragGeometry({
            rootElement: fixture.root,
            session: null
        });

        expect(patched).toBe(snapshot);
        expect(fixture.root.querySelectorAll).toHaveBeenCalledTimes(geometryQueryCount);
        expect(fixture.root.getBoundingClientRect).toHaveBeenCalledTimes(rootRectReadCount + 1);
        expect(source.visualRect.top).toBe(before.visualTop + 30 - 24);
        expect(source.visualRect.left).toBe(before.visualLeft + 15 - 7);
        expect(source.layoutRect.top).toBe(before.layoutTop + 30 - 24);
        expect(source.layoutRect.left).toBe(before.layoutLeft + 15 - 7);
        expect(patched.rootRect.top).toBe(30);
        expect(patched.rootRect.left).toBe(15);
        expect(runtime.dragGeometryDirty).toBe(false);
    });

    it('rebuilds after root scroll when the root size changed before ResizeObserver reports', () => {
        const fixture = createGeometryFixture(1);
        const runtime = {};
        const tree = buildTree({ fixture, runtime });
        tree.handleDragStart({
            target: {
                closest: (selector) => (
                    selector === '.source-item' ? fixture.sources[0] : null
                )
            },
            dataTransfer: {
                setData: jest.fn(),
                effectAllowed: ''
            }
        });
        fixture.resetWritePhase();
        const first = tree.readDragGeometry({
            rootElement: fixture.root,
            session: null
        });
        const geometryQueryCount = fixture.root.querySelectorAll.mock.calls.length;
        const rootRectReadCount = fixture.root.getBoundingClientRect.mock.calls.length;
        fixture.root.getBoundingClientRect.mockImplementation(() => ({
            top: 0,
            bottom: 900,
            left: 0,
            right: 240,
            width: 240,
            height: 900
        }));
        fixture.sources[0].getBoundingClientRect.mockImplementation(() => ({
            top: 90,
            bottom: 130,
            left: 0,
            right: 200,
            width: 200,
            height: 40
        }));

        fixture.root.scrollTop = 10;
        fixture.listeners.get('scroll')({ target: fixture.root });
        fixture.resetWritePhase();
        const rebuilt = tree.readDragGeometry({
            rootElement: fixture.root,
            session: null
        });

        expect(rebuilt).not.toBe(first);
        expect(fixture.root.querySelectorAll).toHaveBeenCalledTimes(geometryQueryCount + 1);
        expect(fixture.root.getBoundingClientRect).toHaveBeenCalledTimes(rootRectReadCount + 1);
        expect(fixture.sources[0].getBoundingClientRect).toHaveBeenCalledTimes(2);
        expect(rebuilt.rootRect.height).toBe(900);
        expect(rebuilt.sourceEntries.get('source-0').visualRect.top).toBe(90);
        expect(runtime.dragGeometryDirty).toBe(false);
    });

    it('patches only descendants when a nested group-children scroller moves', () => {
        const fixture = createNestedFixture();
        const runtime = {};
        const tree = buildTree({
            fixture,
            runtime,
            state: { root: [{ type: 'group', id: 'same-key' }], ungrouped: [] },
            groupsById: new Map([['same-key', {
                id: 'same-key',
                collapsed: false,
                children: [{ type: 'source', key: 'same-key' }]
            }]])
        });
        tree.handleDragStart({
            target: {
                closest: (selector) => (
                    selector === '.source-item' ? fixture.source : null
                )
            },
            dataTransfer: {
                setData: jest.fn(),
                effectAllowed: ''
            }
        });
        fixture.resetWritePhase();
        const snapshot = tree.readDragGeometry({
            rootElement: fixture.root,
            session: null
        });
        const group = snapshot.groups.get('same-key');
        const source = snapshot.sourceEntries.get('same-key');
        const before = {
            groupVisualTop: group.visualRect.top,
            groupLayoutTop: group.layoutRect.top,
            headerVisualTop: group.header.visualRect.top,
            childrenVisualTop: group.children.visualRect.top,
            sourceVisualTop: source.visualRect.top,
            sourceLayoutTop: source.layoutRect.top
        };
        const geometryQueryCount = fixture.root.querySelectorAll.mock.calls.length;
        const rootRectReadCount = fixture.root.getBoundingClientRect.mock.calls.length;
        const scrollListener = fixture.listeners.get('scroll');

        fixture.children.scrollTop = 18;
        scrollListener({ target: fixture.children });
        fixture.resetWritePhase();
        const patched = tree.readDragGeometry({
            rootElement: fixture.root,
            session: null
        });

        expect(patched).toBe(snapshot);
        expect(fixture.root.querySelectorAll).toHaveBeenCalledTimes(geometryQueryCount);
        expect(fixture.root.getBoundingClientRect).toHaveBeenCalledTimes(rootRectReadCount + 1);
        expect(fixture.group.getBoundingClientRect).toHaveBeenCalledTimes(1);
        expect(fixture.header.getBoundingClientRect).toHaveBeenCalledTimes(1);
        expect(fixture.children.getBoundingClientRect).toHaveBeenCalledTimes(2);
        expect(fixture.source.getBoundingClientRect).toHaveBeenCalledTimes(1);
        expect(group.visualRect.top).toBe(before.groupVisualTop);
        expect(group.layoutRect.top).toBe(before.groupLayoutTop);
        expect(group.header.visualRect.top).toBe(before.headerVisualTop);
        expect(group.children.visualRect.top).toBe(before.childrenVisualTop);
        expect(source.visualRect.top).toBe(before.sourceVisualTop - 18);
        expect(source.layoutRect.top).toBe(before.sourceLayoutTop - 18);
        expect(runtime.dragGeometryDirty).toBe(false);
    });

    it('rebuilds when a nested scroller size changes before ResizeObserver reports', () => {
        const fixture = createNestedFixture();
        const runtime = {};
        const tree = buildTree({
            fixture,
            runtime,
            state: { root: [{ type: 'group', id: 'same-key' }], ungrouped: [] },
            groupsById: new Map([['same-key', {
                id: 'same-key',
                collapsed: false,
                children: [{ type: 'source', key: 'same-key' }]
            }]])
        });
        tree.handleDragStart({
            target: {
                closest: (selector) => (
                    selector === '.source-item' ? fixture.source : null
                )
            },
            dataTransfer: {
                setData: jest.fn(),
                effectAllowed: ''
            }
        });
        fixture.resetWritePhase();
        const first = tree.readDragGeometry({
            rootElement: fixture.root,
            session: null
        });
        const geometryQueryCount = fixture.root.querySelectorAll.mock.calls.length;
        const rootRectReadCount = fixture.root.getBoundingClientRect.mock.calls.length;
        fixture.children.getBoundingClientRect.mockImplementation(() => ({
            top: 140,
            bottom: 200,
            left: 0,
            right: 200,
            width: 200,
            height: 60
        }));

        fixture.children.scrollTop = 10;
        fixture.listeners.get('scroll')({ target: fixture.children });
        fixture.resetWritePhase();
        const rebuilt = tree.readDragGeometry({
            rootElement: fixture.root,
            session: null
        });

        expect(rebuilt).not.toBe(first);
        expect(fixture.root.querySelectorAll).toHaveBeenCalledTimes(geometryQueryCount + 1);
        expect(fixture.root.getBoundingClientRect).toHaveBeenCalledTimes(rootRectReadCount + 1);
        expect(fixture.children.getBoundingClientRect).toHaveBeenCalledTimes(3);
        expect(rebuilt.groups.get('same-key').children.visualRect.height).toBe(60);
        expect(runtime.dragGeometryDirty).toBe(false);
    });

    it.each([
        ['scroll then render', true],
        ['render then scroll', false]
    ])('rebuilds instead of scroll-patching after mixed invalidation: %s', (_label, scrollFirst) => {
        const fixture = createGeometryFixture(1);
        const runtime = {};
        const tree = buildTree({ fixture, runtime });
        tree.handleDragStart({
            target: {
                closest: (selector) => (
                    selector === '.source-item' ? fixture.sources[0] : null
                )
            },
            dataTransfer: {
                setData: jest.fn(),
                effectAllowed: ''
            }
        });
        fixture.resetWritePhase();
        const first = tree.readDragGeometry({
            rootElement: fixture.root,
            session: null
        });
        const geometryQueryCount = fixture.root.querySelectorAll.mock.calls.length;
        const scrollListener = fixture.listeners.get('scroll');
        const invalidateRender = () => tree.invalidateDragGeometry(
            'render_rows_replaced',
            { schedule: false }
        );
        const invalidateScroll = () => {
            fixture.root.scrollTop = 10;
            scrollListener({ target: fixture.root });
        };
        if (scrollFirst) {
            invalidateScroll();
            invalidateRender();
        } else {
            invalidateRender();
            invalidateScroll();
        }
        fixture.sources[0].getBoundingClientRect.mockImplementation(() => ({
            top: 90,
            bottom: 130,
            left: 0,
            right: 200,
            width: 200,
            height: 40
        }));

        fixture.resetWritePhase();
        const rebuilt = tree.readDragGeometry({
            rootElement: fixture.root,
            session: null
        });

        expect(rebuilt).not.toBe(first);
        expect(fixture.root.querySelectorAll).toHaveBeenCalledTimes(geometryQueryCount + 1);
        expect(fixture.sources[0].getBoundingClientRect).toHaveBeenCalledTimes(2);
        expect(rebuilt.sourceEntries.get('source-0').visualRect.top).toBe(90);
        expect(runtime.dragGeometryDirty).toBe(false);
    });

    it('reuses the changed root rect while rebuilding once after root size changes', () => {
        const fixture = createGeometryFixture(2);
        const runtime = {};
        const tree = buildTree({ fixture, runtime });
        const first = tree.readDragGeometry({
            rootElement: fixture.root,
            session: null
        });
        fixture.root.getBoundingClientRect.mockImplementation(() => ({
            top: 0,
            bottom: 900,
            left: 0,
            right: 240,
            width: 240,
            height: 900
        }));

        const rebuilt = tree.readDragGeometry({
            rootElement: fixture.root,
            session: null
        });

        expect(rebuilt).not.toBe(first);
        expect(fixture.root.getBoundingClientRect).toHaveBeenCalledTimes(2);
        expect(fixture.root.querySelectorAll).toHaveBeenCalledTimes(2);
        fixture.sources.forEach((source) => {
            expect(source.getBoundingClientRect).toHaveBeenCalledTimes(2);
        });
        expect(rebuilt.rootRect.height).toBe(900);
    });

    it('does not publish a partial snapshot or clear dirty when a geometry read fails', () => {
        const fixture = createGeometryFixture(2);
        const runtime = {};
        const tree = buildTree({ fixture, runtime });
        const first = tree.readDragGeometry({ rootElement: fixture.root, session: null });

        tree.invalidateDragGeometry('row_replaced', { schedule: false });
        fixture.sources[1].getBoundingClientRect = jest.fn(() => {
            throw new Error('detached during read');
        });
        const failed = tree.readDragGeometry({ rootElement: fixture.root, session: null });

        expect(failed).toBeNull();
        expect(runtime.dragGeometryDirty).toBe(true);
        expect(runtime.dragGeometrySnapshot).toBe(first);
    });

    it('fails closed and clears the last applied intent, feedback, and shifts after a geometry read error', () => {
        const createContentDragReflow = require('../../src/content/content-drag-reflow.js');
        const fixture = createNestedFixture();
        const groupState = {
            id: 'same-key',
            collapsed: false,
            children: [{ type: 'source', key: 'same-key' }]
        };
        const state = {
            root: [{ type: 'group', id: 'same-key' }],
            ungrouped: []
        };
        const session = {
            draggedType: 'source',
            draggedKeys: new Set(['drag-other']),
            totalDraggedHeight: 40,
            currentIntent: null,
            shiftedItems: new Map(),
            shiftedSourceItems: new Map(),
            shiftedGroupItems: new Map()
        };
        const runtime = {
            activeDragContext: {
                kind: 'source-single',
                keys: ['drag-other']
            },
            dragReflowSession: session
        };
        const tree = buildTree({
            fixture,
            runtime,
            state,
            groupsById: new Map([['same-key', groupState]]),
            dragReflow: createContentDragReflow()
        });
        const validTransfer = { dropEffect: 'none' };

        tree.handleDragOver({
            preventDefault: jest.fn(),
            clientX: 180,
            clientY: 110,
            dataTransfer: validTransfer
        });

        expect(session.currentIntent).toMatchObject({
            kind: 'into-group',
            targetGroupId: 'same-key'
        });
        expect(validTransfer.dropEffect).toBe('move');
        expect(fixture.group.classList.has('drag-into')).toBe(true);
        expect(session.shiftedSourceItems.size).toBeGreaterThan(0);
        expect(fixture.source.style.transform).toBe('translateY(40px)');

        tree.invalidateDragGeometry('transient_geometry_failure', { schedule: false });
        fixture.resetWritePhase();
        fixture.source.getBoundingClientRect = jest.fn(() => {
            throw new Error('row detached while reading');
        });
        const failedTransfer = { dropEffect: 'move' };
        tree.handleDragOver({
            preventDefault: jest.fn(),
            clientX: 180,
            clientY: 110,
            dataTransfer: failedTransfer
        });

        expect(session.currentIntent).toBeNull();
        // Native feedback was set conservatively while geometry was dirty.
        // The failed async refresh must not rewrite DataTransfer outside the
        // original dragover event, while the internal intent still fails closed.
        expect(failedTransfer.dropEffect).toBe('move');
        expect(fixture.group.classList.has('drag-into')).toBe(false);
        expect(session.shiftedSourceItems).toEqual(new Map());
        expect(fixture.source.style.transform).toBe('');

        const beforeDrop = JSON.parse(JSON.stringify(state));
        tree.handleDrop({
            preventDefault: jest.fn(),
            clientX: 180,
            clientY: 110,
            dataTransfer: {
                getData: (type) => (
                    type === 'application/source-key' ? 'drag-other' : ''
                )
            }
        });
        expect(state).toEqual(beforeDrop);
    });

    it('plans shifts only for visible geometry when filtered state entries are absent from the DOM', () => {
        const createContentDragReflow = require('../../src/content/content-drag-reflow.js');
        const fixture = createGeometryFixture(2);
        const session = {
            draggedType: 'source',
            draggedKeys: new Set(['drag-other']),
            totalDraggedHeight: 40,
            currentIntent: null,
            shiftedItems: new Map(),
            shiftedSourceItems: new Map(),
            shiftedGroupItems: new Map()
        };
        const runtime = {
            activeDragContext: {
                kind: 'source-single',
                keys: ['drag-other']
            },
            dragReflowSession: session
        };
        const state = {
            root: [
                { type: 'source', key: 'source-0' },
                { type: 'source', key: 'filtered-hidden' },
                { type: 'source', key: 'source-1' }
            ],
            ungrouped: []
        };
        const tree = buildTree({
            fixture,
            runtime,
            state,
            dragReflow: createContentDragReflow()
        });
        const snapshot = tree.readDragGeometry({
            rootElement: fixture.root,
            session
        });
        const plan = tree.planDragFrame({
            pointer: { clientX: 100, clientY: 145 },
            geometrySnapshot: snapshot,
            state,
            groupsById: new Map(),
            parentMap: new Map(),
            dragContext: runtime.activeDragContext,
            previousIntent: null,
            dataTransfer: { dropEffect: 'none' }
        });

        expect(plan.intent).toMatchObject({
            kind: 'before-source',
            slotKey: 'source-1'
        });
        expect(plan.shifts.sources).toEqual(new Map([['source-1', 40]]));
        expect(plan.shifts.sources.has('filtered-hidden')).toBe(false);
        tree.applyDragFramePlan(plan);
        expect(runtime.dragGeometryDirty).toBe(false);
        expect(session.shiftedSourceItems).toEqual(new Map([['source-1', 40]]));
        expect(fixture.root.querySelector).not.toHaveBeenCalledWith(
            expect.stringContaining('filtered-hidden')
        );
    });

    it('marks only viewport and one-slot overscan shifts for animation', () => {
        const fixture = createGeometryFixture(6);
        fixture.root.getBoundingClientRect.mockReturnValue({
            top: 0,
            bottom: 200,
            left: 0,
            right: 240,
            width: 240,
            height: 200
        });
        const session = {
            draggedType: 'source',
            draggedKeys: new Set(['drag-other']),
            totalDraggedHeight: 2000,
            currentIntent: null,
            shiftedItems: new Map(),
            shiftedSourceItems: new Map(),
            shiftedGroupItems: new Map()
        };
        const runtime = {
            activeDragContext: {
                kind: 'source-single',
                keys: ['drag-other']
            },
            dragReflowSession: session
        };
        const state = {
            root: fixture.sources.map((source) => ({
                type: 'source',
                key: source.dataset.sourceKey
            })),
            ungrouped: []
        };
        const tree = buildTree({ fixture, runtime, state });
        const snapshot = tree.readDragGeometry({
            rootElement: fixture.root,
            session
        });
        const plan = tree.planDragFrame({
            pointer: { clientX: 100, clientY: 145 },
            geometrySnapshot: snapshot,
            state,
            groupsById: new Map(),
            parentMap: new Map(),
            dragContext: runtime.activeDragContext,
            previousIntent: null,
            dataTransfer: { dropEffect: 'none' }
        });

        expect(plan.intent).toMatchObject({
            kind: 'before-source',
            slotKey: 'source-1'
        });
        expect(Array.from(plan.shifts.sources.keys())).toEqual([
            'source-1',
            'source-2',
            'source-3',
            'source-4',
            'source-5'
        ]);
        expect(Array.from(
            plan.shifts._shiftDeltaPlan.animatedKeys.sources
        )).toEqual([
            'source-1',
            'source-2',
            'source-3'
        ]);
    });

    it('preserves heterogeneous DOM order at both root and group-child levels', () => {
        const rect = (top) => ({
            top,
            bottom: top + 20,
            left: 0,
            right: 200,
            width: 200,
            height: 20
        });
        const classList = (...classes) => ({
            contains: (name) => classes.includes(name)
        });
        const root = {
            getBoundingClientRect: () => ({
                top: 0, bottom: 500, left: 0, right: 240, width: 240, height: 500
            })
        };
        const group = {
            dataset: { groupId: 'root-group' },
            style: {},
            parentElement: root,
            classList: classList('group-container'),
            getBoundingClientRect: () => rect(40)
        };
        const header = {
            dataset: { groupId: 'root-group' },
            parentElement: group,
            classList: classList('group-header'),
            getBoundingClientRect: () => rect(40)
        };
        const children = {
            parentElement: group,
            classList: classList('group-children'),
            getBoundingClientRect: () => rect(60)
        };
        const nestedGroup = {
            dataset: { groupId: 'nested-group' },
            style: {},
            parentElement: children,
            classList: classList('group-container'),
            getBoundingClientRect: () => rect(80)
        };
        const nestedHeader = {
            dataset: { groupId: 'nested-group' },
            parentElement: nestedGroup,
            classList: classList('group-header'),
            getBoundingClientRect: () => rect(80)
        };
        const nestedChildren = {
            parentElement: nestedGroup,
            classList: classList('group-children'),
            getBoundingClientRect: () => rect(100)
        };
        const source = (key, parentElement, top) => ({
            dataset: { sourceKey: key },
            style: {},
            parentElement,
            classList: classList('source-item'),
            getBoundingClientRect: () => rect(top)
        });
        const rootBefore = source('root-before', root, 20);
        const childBefore = source('child-before', children, 60);
        const childAfter = source('child-after', children, 120);
        const rootAfter = source('root-after', root, 140);
        const elements = [
            rootBefore,
            group,
            header,
            children,
            childBefore,
            nestedGroup,
            nestedHeader,
            nestedChildren,
            childAfter,
            rootAfter
        ];
        root.querySelectorAll = jest.fn(() => elements);
        root.contains = (element) => element === root || elements.includes(element);

        const runtime = {};
        const fixture = { root, sources: [] };
        const tree = buildTree({ fixture, runtime, state: { root: [], ungrouped: [] } });
        const snapshot = tree.readDragGeometry({ rootElement: root, session: null });
        const identities = (entries) => entries.map((entry) => (
            entry.identity.type === 'group'
                ? `group:${entry.identity.id}`
                : `source:${entry.identity.key}`
        ));

        expect(identities(snapshot.rootItems)).toEqual([
            'source:root-before',
            'group:root-group',
            'source:root-after'
        ]);
        expect(identities(snapshot.groups.get('root-group').items)).toEqual([
            'source:child-before',
            'group:nested-group',
            'source:child-after'
        ]);
    });

    it('keeps snapshot-path drop intent computation pure when state arrays are absent', () => {
        const tree = createContentTreeInteractions({});
        const group = { id: 'group-1', collapsed: false };
        const state = {};
        const geometrySnapshot = {
            rootRect: {
                top: 0, bottom: 300, left: 0, right: 200, width: 200, height: 300
            },
            bin: null,
            rootItems: [],
            groups: new Map([['group-1', {
                identity: { type: 'group', id: 'group-1' },
                element: {},
                parentGroupId: null,
                layoutRect: {
                    top: 40, bottom: 120, left: 0, right: 200, width: 200, height: 80
                },
                header: {
                    layoutRect: {
                        top: 40, bottom: 60, left: 0, right: 200, width: 200, height: 20
                    }
                },
                children: null,
                items: []
            }]])
        };

        const intent = tree.computeDropIntentRaw({
            clientX: 100,
            clientY: 50,
            state,
            groupsById: new Map([['group-1', group]]),
            parentMap: new Map(),
            activeDragContext: { kind: 'source-single', keys: ['source-1'] },
            geometrySnapshot
        });

        expect(intent.targetList).toEqual([]);
        expect(state).toEqual({});
        expect(group).toEqual({ id: 'group-1', collapsed: false });
    });

    it('returns a local empty-bin trailing intent without mutating an empty state object', () => {
        const tree = createContentTreeInteractions({});
        const state = {};
        const geometrySnapshot = {
            rootRect: {
                top: 0, bottom: 300, left: 0, right: 200, width: 200, height: 300
            },
            bin: null,
            groups: new Map(),
            rootItems: [{
                identity: { type: 'source', key: 'visible-source' },
                visualRect: {
                    top: 40, bottom: 80, left: 0, right: 200, width: 200, height: 40
                },
                element: { classList: { contains: () => false } }
            }]
        };

        const intent = tree.computeDropIntentRaw({
            clientX: 100,
            clientY: 200,
            state,
            groupsById: new Map(),
            parentMap: new Map(),
            activeDragContext: { kind: 'source-single', keys: ['dragged-source'] },
            geometrySnapshot
        });

        expect(intent).toMatchObject({
            isEmptyBinTrailing: true,
            targetList: [],
            insertIndex: 0
        });
        expect(state).toEqual({});
    });

    it('clears a prior valid intent and rejects drop when the next frame has no intent', () => {
        const fixture = createGeometryFixture(1);
        const session = {
            draggedKeys: new Set(['source-0']),
            totalDraggedHeight: 40,
            shiftedItems: new Map(),
            shiftedSourceItems: new Map([['source-0', 40]]),
            shiftedGroupItems: new Map(),
            currentIntent: { kind: 'after-source', slotKey: 'source-0' }
        };
        const runtime = {
            activeDragContext: { kind: 'source-single', keys: ['source-0'] },
            dragReflowSession: session
        };
        const tree = buildTree({ fixture, runtime });
        const snapshot = tree.readDragGeometry({
            rootElement: fixture.root,
            session
        });
        const dataTransfer = { dropEffect: 'move' };
        const plan = tree.planDragFrame({
            pointer: { clientX: 100, clientY: 1200 },
            geometrySnapshot: snapshot,
            state: { root: [{ type: 'source', key: 'source-0' }], ungrouped: [] },
            groupsById: new Map(),
            parentMap: new Map(),
            dragContext: runtime.activeDragContext,
            previousIntent: session.currentIntent,
            dataTransfer
        });

        expect(plan.intent).toBeNull();
        expect(plan.dropEffect).toBe('none');
        expect(plan.shifts.sources).toEqual(new Map());
        expect(plan.shifts._shiftDeltaPlan.deltas.sources).toEqual(
            new Map([['source-0', -40]])
        );
        expect(plan.shifts._shiftDeltaPlan.animatedKeys.sources).toEqual(new Set());
        tree.applyDragFramePlan(plan);
        expect(session.currentIntent).toBeNull();
        // Frame application updates internal feedback only. Native dropEffect
        // is owned by the synchronous handleDragOver event path.
        expect(dataTransfer.dropEffect).toBe('move');
    });

    it('invalidates only for actual scoped scroll changes and current ResizeObserver reports', () => {
        const fixture = createGeometryFixture(2);
        const runtime = {};
        const resizeObservers = [];
        class FakeResizeObserver {
            constructor(callback) {
                this.callback = callback;
                this.observe = jest.fn();
                this.disconnect = jest.fn();
                resizeObservers.push(this);
            }
        }
        const tree = buildTree({
            fixture,
            runtime,
            extraDeps: { ResizeObserver: FakeResizeObserver }
        });
        const source = fixture.sources[0];
        tree.handleDragStart({
            target: {
                closest: (selector) => (selector === '.source-item' ? source : null)
            },
            dataTransfer: {
                setData: jest.fn(),
                effectAllowed: ''
            }
        });
        expect(resizeObservers).toHaveLength(0);

        fixture.resetWritePhase();
        tree.readDragGeometry({ rootElement: fixture.root, session: null });
        const scrollListener = fixture.listeners.get('scroll');
        expect(scrollListener).toBeInstanceOf(Function);
        expect(resizeObservers).toHaveLength(1);
        expect(runtime.dragGeometryDirty).toBe(false);
        resizeObservers[0].callback([{
            target: fixture.root,
            borderBoxSize: [{ inlineSize: 240, blockSize: 1000 }]
        }]);
        expect(runtime.dragGeometryDirty).toBe(false);
        resizeObservers[0].callback([{
            target: fixture.root,
            borderBoxSize: [{ inlineSize: 240, blockSize: 1001 }]
        }]);
        expect(runtime.dragGeometryDirty).toBe(true);

        fixture.resetWritePhase();
        tree.readDragGeometry({ rootElement: fixture.root, session: null });
        scrollListener({ target: fixture.root });
        expect(runtime.dragGeometryDirty).toBe(false);
        fixture.root.scrollTop = 8;
        scrollListener({ target: fixture.root });
        expect(runtime.dragGeometryDirty).toBe(true);

        tree.handleDragEnd({ target: { closest: () => null } });
        expect(resizeObservers[0].disconnect).toHaveBeenCalledTimes(1);
        runtime.dragGeometryDirty = false;
        resizeObservers[0].callback([{
            target: fixture.root,
            borderBoxSize: [{ inlineSize: 240, blockSize: 1200 }]
        }]);
        scrollListener({ target: fixture.root });
        expect(runtime.dragGeometryDirty).toBe(false);
    });

    it('rebinds Classic drag ResizeObserver targets after render replaces group children', () => {
        const fixture = createNestedFixture();
        const runtime = {};
        const resizeObservers = [];
        class FakeResizeObserver {
            constructor(callback) {
                this.callback = callback;
                this.observe = jest.fn();
                this.unobserve = jest.fn();
                this.disconnect = jest.fn();
                resizeObservers.push(this);
            }
        }
        const tree = buildTree({
            fixture,
            runtime,
            state: { root: [{ type: 'group', id: 'same-key' }], ungrouped: [] },
            groupsById: new Map([['same-key', {
                id: 'same-key',
                collapsed: false,
                children: [{ type: 'source', key: 'same-key' }]
            }]]),
            extraDeps: { ResizeObserver: FakeResizeObserver }
        });
        tree.handleDragStart({
            target: {
                closest: (selector) => (
                    selector === '.source-item' ? fixture.source : null
                )
            },
            dataTransfer: {
                setData: jest.fn(),
                effectAllowed: ''
            }
        });
        expect(resizeObservers).toHaveLength(0);
        fixture.resetWritePhase();
        tree.readDragGeometry({ rootElement: fixture.root, session: null });
        const staleChildren = fixture.children;
        expect(resizeObservers[0].observe).toHaveBeenCalledWith(staleChildren);

        const freshFixture = createNestedFixture();
        const rootRectReadsBeforeRender = fixture.root.getBoundingClientRect.mock.calls.length;
        fixture.root.querySelectorAll.mockImplementation((selector) => {
            if (
                selector === '.source-item[data-source-key], .group-container[data-group-id], .group-children'
            ) {
                return [
                    freshFixture.group,
                    freshFixture.children,
                    freshFixture.source
                ];
            }
            return freshFixture.root.querySelectorAll(selector);
        });
        tree.invalidateDragGeometry('render_rows_replaced', { schedule: false });
        tree.applyReflowAfterRender();
        const freshChildren = freshFixture.children;
        expect(fixture.root.getBoundingClientRect).toHaveBeenCalledTimes(rootRectReadsBeforeRender);
        expect(freshChildren.getBoundingClientRect).not.toHaveBeenCalled();
        expect(resizeObservers[0].unobserve).toHaveBeenCalledWith(staleChildren);
        expect(resizeObservers[0].observe).toHaveBeenCalledWith(freshChildren);

        runtime.dragGeometryDirty = false;
        resizeObservers[0].callback([{
            target: staleChildren,
            borderBoxSize: [{ inlineSize: 200, blockSize: 80 }]
        }]);
        expect(runtime.dragGeometryDirty).toBe(false);
        resizeObservers[0].callback([{
            target: freshChildren,
            borderBoxSize: [{ inlineSize: 200, blockSize: 40 }]
        }]);
        expect(runtime.dragGeometryDirty).toBe(false);
        resizeObservers[0].callback([{
            target: freshChildren,
            borderBoxSize: [{ inlineSize: 200, blockSize: 41 }]
        }]);
        expect(runtime.dragGeometryDirty).toBe(true);
        tree.handleDragEnd({ target: { closest: () => null } });
        runtime.dragGeometryDirty = false;
        resizeObservers[0].callback([{
            target: freshChildren,
            borderBoxSize: [{ inlineSize: 200, blockSize: 60 }]
        }]);
        expect(runtime.dragGeometryDirty).toBe(false);
    });

    it('does not reuse a clean Classic snapshot across two drag sessions', () => {
        const fixture = createGeometryFixture(1);
        const runtime = {};
        const tree = buildTree({
            fixture,
            runtime,
            state: {
                root: [{ type: 'source', key: 'source-0' }],
                ungrouped: []
            },
            extraDeps: { getDragMode: () => 'classic' }
        });
        const start = () => tree.handleDragStart({
            target: {
                closest: (selector) => (
                    selector === '.source-item' ? fixture.sources[0] : null
                )
            },
            dataTransfer: {
                setData: jest.fn(),
                effectAllowed: ''
            }
        });

        start();
        fixture.resetWritePhase();
        const first = tree.readDragGeometry({
            rootElement: fixture.root,
            session: null
        });
        expect(first.sourceEntries.get('source-0').visualRect.top).toBe(100);

        tree.handleDragEnd({ target: { closest: () => null } });
        expect(runtime.dragGeometrySnapshot).toBeNull();
        fixture.sources[0].getBoundingClientRect.mockImplementation(() => ({
            top: 260,
            bottom: 300,
            left: 0,
            right: 200,
            width: 200,
            height: 40
        }));

        start();
        fixture.resetWritePhase();
        const second = tree.readDragGeometry({
            rootElement: fixture.root,
            session: null
        });

        expect(second).not.toBe(first);
        expect(second.sourceEntries.get('source-0').visualRect.top).toBe(260);
    });

    it.each(['source', 'group'])(
        'invalidates a snapshot cached before deferred %s folding',
        (kind) => {
            const fixture = createGeometryFixture(1);
            const runtime = {};
            let foldFrame = null;
            const previousRequestAnimationFrame = global.requestAnimationFrame;
            global.requestAnimationFrame = jest.fn((callback) => {
                foldFrame = callback;
                return 1;
            });
            const session = {
                draggedKeys: new Set(['drag-key']),
                totalDraggedHeight: 40,
                shiftedItems: new Map(),
                shiftedSourceItems: new Map(),
                shiftedGroupItems: new Map()
            };
            const dragReflow = {
                prepareDragSession: jest.fn(() => session),
                foldDraggedItems: jest.fn()
            };
            const tree = buildTree({
                fixture,
                runtime,
                dragReflow,
                state: { root: [], ungrouped: [] }
            });
            const sourceTarget = fixture.sources[0];
            const groupHeader = {
                dataset: { groupId: 'drag-key' },
                classList: createTrackedClassList([], () => {})
            };
            tree.handleDragStart({
                target: {
                    closest: (selector) => {
                        if (selector === '.source-item') {
                            return kind === 'source' ? sourceTarget : null;
                        }
                        if (selector === '.group-header') {
                            return kind === 'group' ? groupHeader : null;
                        }
                        return null;
                    }
                },
                dataTransfer: {
                    setData: jest.fn(),
                    effectAllowed: ''
                }
            });

            expect(dragReflow.prepareDragSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    draggedType: kind
                })
            );
            fixture.resetWritePhase();
            tree.readDragGeometry({ rootElement: fixture.root, session });
            expect(runtime.dragGeometryDirty).toBe(false);
            expect(foldFrame).toBeInstanceOf(Function);
            foldFrame();
            expect(dragReflow.foldDraggedItems).toHaveBeenCalledTimes(1);
            expect(runtime.dragGeometryDirty).toBe(true);
            global.requestAnimationFrame = previousRequestAnimationFrame;
        }
    );

    it('ignores a deferred fold callback after dragend cancels its session', () => {
        const fixture = createGeometryFixture(1);
        const runtime = {};
        const foldFrames = [];
        const previousRequestAnimationFrame = global.requestAnimationFrame;
        const previousCancelAnimationFrame = global.cancelAnimationFrame;
        global.requestAnimationFrame = jest.fn((callback) => {
            foldFrames.push(callback);
            return foldFrames.length;
        });
        global.cancelAnimationFrame = jest.fn();
        try {
            const session = {
                draggedType: 'source',
                draggedKeys: new Set(['source-0']),
                totalDraggedHeight: 40,
                shiftedItems: new Map(),
                shiftedSourceItems: new Map(),
                shiftedGroupItems: new Map()
            };
            const dragReflow = {
                prepareDragSession: jest.fn(() => session),
                foldDraggedItems: jest.fn(),
                clearReflow: jest.fn(),
                unfoldDraggedItems: jest.fn()
            };
            const tree = buildTree({
                fixture,
                runtime,
                dragReflow,
                state: {
                    root: [{ type: 'source', key: 'source-0' }],
                    ungrouped: []
                }
            });

            tree.handleDragStart({
                target: {
                    closest: (selector) => (
                        selector === '.source-item' ? fixture.sources[0] : null
                    )
                },
                dataTransfer: {
                    setData: jest.fn(),
                    effectAllowed: ''
                }
            });
            expect(foldFrames).toHaveLength(1);

            fixture.resetWritePhase();
            tree.handleDragEnd({ target: { closest: () => null } });
            foldFrames[0]();

            expect(dragReflow.foldDraggedItems).not.toHaveBeenCalled();
        } finally {
            global.requestAnimationFrame = previousRequestAnimationFrame;
            global.cancelAnimationFrame = previousCancelAnimationFrame;
        }
    });

    it('lets only the newest drag session run its deferred fold callback', () => {
        const fixture = createGeometryFixture(2);
        const runtime = {};
        const foldFrames = [];
        const sessions = [];
        const previousRequestAnimationFrame = global.requestAnimationFrame;
        const previousCancelAnimationFrame = global.cancelAnimationFrame;
        global.requestAnimationFrame = jest.fn((callback) => {
            foldFrames.push(callback);
            return foldFrames.length;
        });
        global.cancelAnimationFrame = jest.fn();
        try {
            const dragReflow = {
                prepareDragSession: jest.fn(({ draggedKeys }) => {
                    const session = {
                        draggedType: 'source',
                        draggedKeys: new Set(draggedKeys),
                        totalDraggedHeight: 40,
                        shiftedItems: new Map(),
                        shiftedSourceItems: new Map(),
                        shiftedGroupItems: new Map()
                    };
                    sessions.push(session);
                    return session;
                }),
                foldDraggedItems: jest.fn(),
                clearReflow: jest.fn(),
                unfoldDraggedItems: jest.fn()
            };
            const tree = buildTree({
                fixture,
                runtime,
                dragReflow,
                state: {
                    root: [
                        { type: 'source', key: 'source-0' },
                        { type: 'source', key: 'source-1' }
                    ],
                    ungrouped: []
                }
            });
            const startSource = (source) => tree.handleDragStart({
                target: {
                    closest: (selector) => (
                        selector === '.source-item' ? source : null
                    )
                },
                dataTransfer: {
                    setData: jest.fn(),
                    effectAllowed: ''
                }
            });

            startSource(fixture.sources[0]);
            startSource(fixture.sources[1]);
            expect(foldFrames).toHaveLength(2);

            foldFrames[0]();
            expect(dragReflow.foldDraggedItems).not.toHaveBeenCalled();
            foldFrames[1]();

            expect(dragReflow.foldDraggedItems).toHaveBeenCalledTimes(1);
            expect(dragReflow.foldDraggedItems).toHaveBeenCalledWith({
                session: sessions[1],
                rootElement: fixture.root
            });
        } finally {
            global.requestAnimationFrame = previousRequestAnimationFrame;
            global.cancelAnimationFrame = previousCancelAnimationFrame;
        }
    });

    it('finishes every geometry read before the first feedback/reflow write', () => {
        const fixture = createGeometryFixture(3);
        const runtime = {
            activeDragContext: { kind: 'source-single', keys: ['source-0'] },
            dragReflowSession: {
                draggedKeys: new Set(['source-0']),
                totalDraggedHeight: 40,
                shiftedItems: new Map(),
                currentIntent: null
            }
        };
        const tree = buildTree({ fixture, runtime });

        expect(() => tree.handleDragOver({
            clientX: 20,
            clientY: 105,
            preventDefault: jest.fn(),
            dataTransfer: { dropEffect: 'move' },
            target: { closest: () => null }
        })).not.toThrow();

        expect(fixture.didWrite()).toBe(true);
        fixture.rectReads.forEach((count) => expect(count).toBe(1));
        expect(fixture.root.querySelectorAll).toHaveBeenCalledTimes(1);
    });

    it('uses the same snapshot for collapsed-hover resolution without a second group scan', () => {
        const fixture = createNestedFixture();
        const groupState = {
            id: 'same-key',
            collapsed: true,
            children: [{ type: 'source', key: 'same-key' }]
        };
        const runtime = {
            activeDragContext: { kind: 'source-single', keys: ['outside'] }
        };
        const tree = buildTree({
            fixture,
            runtime,
            state: { root: [{ type: 'group', id: 'same-key' }], ungrouped: [] },
            groupsById: new Map([['same-key', groupState]])
        });

        tree.handleDragOver({
            clientX: 150,
            clientY: 110,
            preventDefault: jest.fn(),
            dataTransfer: { dropEffect: 'move' },
            target: { closest: () => null }
        });

        expect(fixture.root.querySelectorAll).toHaveBeenCalledTimes(1);
        expect(runtime.dragGeometryDirty).toBe(true);
    });

    it('patches descendant/header/children visual rects for a pure ancestor transform', () => {
        const fixture = createNestedFixture();
        const runtime = {
            activeDragContext: { kind: 'source-single', keys: ['outside'] },
            dragReflowSession: {
                draggedKeys: new Set(['outside']),
                totalDraggedHeight: 24,
                shiftedItems: new Map(),
                currentIntent: null
            }
        };
        const tree = buildTree({
            fixture,
            runtime,
            state: { root: [{ type: 'group', id: 'same-key' }], ungrouped: [] },
            groupsById: new Map([['same-key', {
                id: 'same-key',
                collapsed: false,
                children: [{ type: 'source', key: 'same-key' }]
            }]]),
            dragReflow: {
                applyReflow: jest.fn(() => ({ complete: true }))
            }
        });
        const snapshot = tree.readDragGeometry({ rootElement: fixture.root, session: runtime.dragReflowSession });
        fixture.resetWritePhase();

        tree.applyDragFramePlan({
            intent: null,
            isInvalid: false,
            dropEffect: 'move',
            shifts: {
                sources: new Map(),
                groups: new Map([['same-key', 24]])
            },
            feedback: {},
            geometrySnapshot: snapshot
        });

        expect(snapshot.groups.get('same-key').visualRect.top).toBe(124);
        expect(snapshot.groups.get('same-key').header.visualRect.top).toBe(124);
        expect(snapshot.groups.get('same-key').children.visualRect.top).toBe(164);
        expect(snapshot.sourceEntries.get('same-key').visualRect.top).toBe(164);
        expect(snapshot.sourceEntries.get('same-key').layoutRect.top).toBe(140);
        expect(runtime.dragGeometryDirty).toBe(false);
    });

    it('patches only the applied typed deltas returned by the reflow writer', () => {
        const fixture = createGeometryFixture(2);
        const runtime = {
            activeDragContext: { kind: 'source-single', keys: ['source-0'] },
            dragReflowSession: {
                draggedKeys: new Set(['source-0']),
                totalDraggedHeight: 40,
                shiftedSourceItems: new Map(),
                shiftedGroupItems: new Map(),
                currentIntent: null
            }
        };
        const dragReflow = {
            supportsAppliedShiftDeltas: true,
            applyReflow: jest.fn(() => ({
                complete: true,
                appliedShiftDeltas: {
                    sources: new Map([['source-1', 40]]),
                    groups: new Map()
                }
            }))
        };
        const tree = buildTree({ fixture, runtime, dragReflow });
        const snapshot = tree.readDragGeometry({
            rootElement: fixture.root,
            session: runtime.dragReflowSession
        });
        const source0Top = snapshot.sourceEntries.get('source-0').visualRect.top;
        const source1Top = snapshot.sourceEntries.get('source-1').visualRect.top;
        fixture.resetWritePhase();

        tree.applyDragFramePlan({
            intent: null,
            isInvalid: false,
            dropEffect: 'move',
            shifts: {
                sources: new Map([['source-1', 40]]),
                groups: new Map()
            },
            feedback: {},
            geometrySnapshot: snapshot
        });

        expect(snapshot.sourceEntries.get('source-0').visualRect.top).toBe(source0Top);
        expect(snapshot.sourceEntries.get('source-1').visualRect.top).toBe(source1Top + 40);
        expect(runtime.dragGeometryDirty).toBe(false);
    });

    it('leaves the cached snapshot unchanged when the reflow writer throws', () => {
        const fixture = createGeometryFixture(1);
        const runtime = {
            activeDragContext: { kind: 'source-single', keys: ['source-0'] },
            dragReflowSession: {
                draggedKeys: new Set(['source-0']),
                totalDraggedHeight: 40,
                shiftedSourceItems: new Map(),
                shiftedGroupItems: new Map(),
                currentIntent: null
            }
        };
        const dragReflow = {
            supportsAppliedShiftDeltas: true,
            applyReflow: jest.fn(() => {
                throw new Error('write failed');
            })
        };
        const tree = buildTree({ fixture, runtime, dragReflow });
        const snapshot = tree.readDragGeometry({
            rootElement: fixture.root,
            session: runtime.dragReflowSession
        });
        const beforeTop = snapshot.sourceEntries.get('source-0').visualRect.top;
        fixture.resetWritePhase();

        expect(() => tree.applyDragFramePlan({
            intent: null,
            isInvalid: false,
            dropEffect: 'move',
            shifts: {
                sources: new Map([['source-0', 40]]),
                groups: new Map()
            },
            feedback: {},
            geometrySnapshot: snapshot
        })).toThrow('write failed');

        expect(snapshot.sourceEntries.get('source-0').visualRect.top).toBe(beforeTop);
    });

    it('marks geometry dirty when a transform plan cannot be patched completely', () => {
        const fixture = createGeometryFixture(1);
        const runtime = {
            activeDragContext: { kind: 'source-single', keys: ['source-0'] },
            dragReflowSession: {
                draggedKeys: new Set(['source-0']),
                totalDraggedHeight: 40,
                shiftedItems: new Map(),
                currentIntent: null
            }
        };
        const tree = buildTree({ fixture, runtime });
        const snapshot = tree.readDragGeometry({ rootElement: fixture.root, session: runtime.dragReflowSession });
        fixture.resetWritePhase();

        tree.applyDragFramePlan({
            intent: null,
            isInvalid: false,
            dropEffect: 'move',
            shifts: {
                sources: new Map([['missing-source', 40]]),
                groups: new Map()
            },
            feedback: {},
            geometrySnapshot: snapshot
        });

        expect(runtime.dragGeometryDirty).toBe(true);
    });
});
