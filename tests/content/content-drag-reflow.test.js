const createContentDragReflow = require('../../src/content/content-drag-reflow.js');

// Manual DOM mock matching the rest of this project's content tests
// (see content-drag-multi.test.js makeDocument). Avoids adding a jsdom dep.
//
// items input shape (array): [{ key, attr, height }]
//   - key: string identifier
//   - attr: 'data-source-key' | 'data-group-id'
//   - height: number used as offsetHeight
// Returns { root, items } where:
//   - root.querySelector resolves [data-source-key="K"] or [data-group-id="K"]
//   - items[key] is a stable mock element with offsetHeight + style + classList
function makeRoot(items) {
    const byKey = Object.create(null);
    const normalized = Array.isArray(items)
        ? items
        : Object.entries(items || {}).map(([key, v]) => ({
            key,
            attr: v.attr,
            height: typeof v.offsetHeight === 'number' ? v.offsetHeight : v.height
        }));

    for (const { key, attr, height, computedStyle = {}, inlineStyle = {} } of normalized) {
        const classes = new Set();
        byKey[key] = {
            attr,
            offsetHeight: typeof height === 'number' ? height : 0,
            computedStyle,
            style: {
                transform: '',
                height: inlineStyle.height || '',
                opacity: inlineStyle.opacity || ''
            },
            classList: {
                add(name) { classes.add(name); },
                remove(name) { classes.delete(name); },
                contains(name) { return classes.has(name); }
            }
        };
    }

    const root = {
        querySelector: jest.fn((selector) => {
            const match = selector.match(/^\[(data-source-key|data-group-id)="(.*)"\]$/);
            if (!match) return null;
            const [, attr, key] = match;
            const item = byKey[key];
            if (!item || item.attr !== attr) return null;
            return item;
        })
    };

    return { root, items: byKey };
}

function makeProbeLayoutRoot({
    placement = 'middle',
    selectedKeys = ['drag'],
    rectsByLabel = {}
} = {}) {
    const operationLog = [];
    const layoutState = {
        pendingWrite: false,
        forcedLayoutReadPhases: 0,
        sawFoldedEndState: false
    };
    const hasPrev = placement === 'middle' || placement === 'last';
    const hasNext = placement === 'middle' || placement === 'first';
    const dragTop = hasPrev ? 148 : 100;
    const endBefore = hasNext ? dragTop + 104 : dragTop + 48;
    const endAfter = endBefore - 48;
    const defaultRectsByLabel = {
        root: {
            before: { top: 100, bottom: endBefore, height: endBefore - 100 },
            after: { top: 100, bottom: endAfter, height: endAfter - 100 },
            settle: { top: 100, bottom: endBefore, height: endBefore - 100 }
        },
        prev: {
            before: { top: 100, bottom: 140, height: 40 },
            after: { top: 100, bottom: 140, height: 40 },
            settle: { top: 100, bottom: 140, height: 40 }
        },
        drag: {
            before: { top: dragTop, bottom: dragTop + 48, height: 48 },
            after: { top: dragTop, bottom: dragTop, height: 0 },
            settle: { top: dragTop, bottom: dragTop + 48, height: 48 }
        },
        next: {
            before: { top: dragTop + 56, bottom: dragTop + 104, height: 48 },
            after: { top: dragTop + 8, bottom: dragTop + 56, height: 48 },
            settle: { top: dragTop + 56, bottom: dragTop + 104, height: 48 }
        },
        sentinel: {
            before: { top: endBefore, bottom: endBefore, height: 0 },
            after: { top: endAfter, bottom: endAfter, height: 0 },
            settle: { top: endBefore, bottom: endBefore, height: 0 }
        }
    };
    const markWrite = (label) => {
        operationLog.push(label);
        layoutState.pendingWrite = true;
    };
    const markRead = (label) => {
        operationLog.push(label);
        if (layoutState.pendingWrite) {
            layoutState.forcedLayoutReadPhases += 1;
            layoutState.pendingWrite = false;
        }
    };
    const toCamelCase = (name) => String(name).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const toKebabCase = (name) => String(name).replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

    function createStyle(ownerLabel, initial = {}) {
        const values = new Map();
        const priorities = new Map();
        Object.entries(initial).forEach(([name, entry]) => {
            const property = toKebabCase(name);
            const value = entry && typeof entry === 'object' ? entry.value : entry;
            const priority = entry && typeof entry === 'object' ? entry.priority : '';
            values.set(property, String(value ?? ''));
            priorities.set(property, String(priority || ''));
        });
        const style = {
            setProperty(name, value, priority = '') {
                const property = toKebabCase(name);
                values.set(property, String(value));
                priorities.set(property, String(priority || ''));
                markWrite(`${ownerLabel}:style:${property}=${value}!${priority || ''}`);
            },
            getPropertyValue(name) {
                return values.get(toKebabCase(name)) || '';
            },
            getPropertyPriority(name) {
                return priorities.get(toKebabCase(name)) || '';
            },
            removeProperty(name) {
                const property = toKebabCase(name);
                const previous = values.get(property) || '';
                values.delete(property);
                priorities.delete(property);
                markWrite(`${ownerLabel}:style:${property}=removed`);
                return previous;
            }
        };
        for (const property of [
            'height', 'opacity', 'transform', 'transition', 'animation', 'overflowAnchor'
        ]) {
            Object.defineProperty(style, property, {
                configurable: true,
                get() {
                    return values.get(toKebabCase(property)) || '';
                },
                set(value) {
                    const cssProperty = toKebabCase(property);
                    values.set(cssProperty, String(value));
                    priorities.set(cssProperty, '');
                    markWrite(`${ownerLabel}:style:${cssProperty}=${value}`);
                }
            });
        }
        return style;
    }

    let prev = null;
    let drag = null;
    let next = null;
    let root = null;

    function isFolded(node) {
        return Boolean(
            node
            && (
                node.style.height === '0px'
                || node.classList.contains('sp-drag-folded')
            )
        );
    }

    function selectedNode(key) {
        if (!root) return null;
        return root.querySelector(`[data-source-key="${key}"]`)
            || root.querySelector(`[data-group-id="${key}"]`);
    }

    function currentLayoutPhase() {
        const selected = selectedKeys.map(selectedNode).filter(Boolean);
        const allFolded = selected.length === selectedKeys.length
            && selected.length > 0
            && selected.every(isFolded);
        if (allFolded) {
            layoutState.sawFoldedEndState = true;
            return 'after';
        }
        return layoutState.sawFoldedEndState ? 'settle' : 'before';
    }

    function createNode(label, attributes = {}, options = {}) {
        const classes = new Set(options.classes || []);
        const attributesMap = new Map(Object.entries(attributes));
        const node = {
            label,
            dataset: {},
            children: [],
            parentElement: null,
            ownerDocument: null,
            offsetHeight: options.offsetHeight || 0,
            computedStyle: Object.assign({
                boxSizing: 'border-box',
                marginTop: '0px',
                marginBottom: '0px',
                paddingTop: '0px',
                paddingBottom: '0px',
                borderTopWidth: '0px',
                borderBottomWidth: '0px'
            }, options.computedStyle || {}),
            style: createStyle(label, options.inlineStyle || {}),
            classList: {
                add(...names) {
                    names.forEach((name) => classes.add(name));
                    markWrite(`${label}:class=${Array.from(classes).join(' ')}`);
                },
                remove(...names) {
                    names.forEach((name) => classes.delete(name));
                    markWrite(`${label}:class=${Array.from(classes).join(' ')}`);
                },
                contains(name) {
                    return classes.has(name);
                }
            },
            setAttribute(name, value) {
                attributesMap.set(name, String(value));
                if (name === 'data-source-key') this.dataset.sourceKey = String(value);
                if (name === 'data-group-id') this.dataset.groupId = String(value);
                markWrite(`${label}:attr:${name}=${value}`);
            },
            getAttribute(name) {
                return attributesMap.has(name) ? attributesMap.get(name) : null;
            },
            hasAttribute(name) {
                return attributesMap.has(name);
            },
            removeAttribute(name) {
                attributesMap.delete(name);
                markWrite(`${label}:attr:${name}=removed`);
            },
            appendChild(child) {
                if (child.parentElement) child.parentElement.removeChild(child);
                child.parentElement = this;
                this.children.push(child);
                markWrite(`${label}:append:${child.label}`);
                return child;
            },
            insertBefore(child, reference) {
                if (child.parentElement) child.parentElement.removeChild(child);
                const index = this.children.indexOf(reference);
                child.parentElement = this;
                this.children.splice(index >= 0 ? index : this.children.length, 0, child);
                markWrite(`${label}:insert:${child.label}`);
                return child;
            },
            removeChild(child) {
                const index = this.children.indexOf(child);
                if (index >= 0) this.children.splice(index, 1);
                child.parentElement = null;
                markWrite(`${label}:remove:${child.label}`);
                return child;
            },
            remove() {
                if (this.parentElement) this.parentElement.removeChild(this);
            },
            contains(candidate) {
                if (candidate === this) return true;
                return this.children.some((child) => child.contains(candidate));
            },
            querySelector(selector) {
                return this.querySelectorAll(selector)[0] || null;
            },
            querySelectorAll(selector) {
                const sourceMatch = selector.match(/^\[data-source-key="(.*)"\]$/);
                const groupMatch = selector.match(/^\[data-group-id="(.*)"\]$/);
                const all = [];
                const visit = (candidate) => {
                    for (const child of candidate.children) {
                        if (
                            (sourceMatch && child.getAttribute('data-source-key') === sourceMatch[1])
                            || (groupMatch && child.getAttribute('data-group-id') === groupMatch[1])
                            || (selector === '[data-source-key], [data-group-id]'
                                && (child.hasAttribute('data-source-key') || child.hasAttribute('data-group-id')))
                        ) {
                            all.push(child);
                        }
                        visit(child);
                    }
                };
                visit(this);
                return all;
            },
            getBoundingClientRect() {
                const phase = currentLayoutPhase();
                markRead(`${label}:rect:${phase}`);
                const scripted = rectsByLabel[label]
                    || (
                        label.startsWith('sentinel-') && this.parentElement
                            ? rectsByLabel[`${this.parentElement.label}:sentinel`]
                            : null
                    )
                    || (label.startsWith('sentinel-') ? rectsByLabel.sentinel : null)
                    || defaultRectsByLabel[label]
                    || defaultRectsByLabel.sentinel;
                return Object.assign({}, scripted[phase] || scripted.before);
            },
            getAnimations: jest.fn(() => [])
        };
        for (const [name, value] of attributesMap) {
            if (name === 'data-source-key') node.dataset.sourceKey = value;
            if (name === 'data-group-id') node.dataset.groupId = value;
        }
        Object.defineProperty(node, 'nextElementSibling', {
            get() {
                if (!this.parentElement) return null;
                const index = this.parentElement.children.indexOf(this);
                return this.parentElement.children[index + 1] || null;
            }
        });
        return node;
    }

    const createdNodes = [];
    const document = {
        createElement() {
            const node = createNode(`sentinel-${createdNodes.length + 1}`);
            node.ownerDocument = document;
            createdNodes.push(node);
            return node;
        }
    };
    root = createNode('root');
    prev = createNode('prev', { 'data-source-key': 'prev' }, { offsetHeight: 40 });
    drag = createNode('drag', { 'data-source-key': 'drag' }, {
        offsetHeight: 48,
        classes: ['pre-existing', 'sp-drag-unfolding'],
        computedStyle: {
            marginTop: '4px',
            marginBottom: '4px'
        },
        inlineStyle: {
            height: { value: '17px', priority: '' },
            opacity: { value: '0.65', priority: '' },
            transition: { value: 'height 180ms ease', priority: 'important' },
            animation: { value: 'fixture-pulse 1s linear', priority: '' },
            overflowAnchor: { value: 'auto', priority: 'important' }
        }
    });
    next = createNode('next', { 'data-source-key': 'next' }, {
        offsetHeight: 48,
        computedStyle: { marginTop: '16px' }
    });
    root.ownerDocument = document;
    prev.ownerDocument = document;
    drag.ownerDocument = document;
    next.ownerDocument = document;
    if (hasPrev) root.appendChild(prev);
    root.appendChild(drag);
    if (hasNext) root.appendChild(next);
    operationLog.length = 0;
    layoutState.pendingWrite = false;
    layoutState.forcedLayoutReadPhases = 0;
    layoutState.sawFoldedEndState = false;

    return {
        root,
        prev,
        drag,
        next,
        document,
        createNode,
        createdNodes,
        operationLog,
        layoutState
    };
}

describe('content-drag-reflow factory', () => {
    test('exposes createDragSession factory', () => {
        const api = createContentDragReflow();
        expect(api.TRANSITION_MS).toBe(180);
        expect(api.createDragSession).toBeInstanceOf(Function);
        const session = api.createDragSession();
        expect(session.draggedKeys).toBeInstanceOf(Set);
        expect(session.itemHeights).toBeInstanceOf(Map);
        expect(session.shiftedItems).toBeInstanceOf(Map);
        expect(session.totalDraggedHeight).toBe(0);
        expect(session.currentIntent).toBeNull();
    });
});

describe('prepareDragSession', () => {
    let api;
    beforeEach(() => {
        api = createContentDragReflow();
    });

    test('measures and caches heights for dragged items', () => {
        const { root } = makeRoot([
            { key: 'k1', attr: 'data-source-key', height: 48 },
            { key: 'k2', attr: 'data-source-key', height: 60 }
        ]);

        const session = api.prepareDragSession({
            draggedKeys: ['k1', 'k2'],
            rootElement: root
        });

        expect(session.draggedKeys.has('k1')).toBe(true);
        expect(session.draggedKeys.has('k2')).toBe(true);
        expect(session.itemHeights.get('k1')).toBe(48);
        expect(session.itemHeights.get('k2')).toBe(60);
        expect(session.totalDraggedHeight).toBe(108);
    });

    test('falls back to 0 height when element missing', () => {
        const { root } = makeRoot([]);
        const session = api.prepareDragSession({
            draggedKeys: ['missing'],
            rootElement: root
        });
        expect(session.itemHeights.get('missing')).toBe(0);
        expect(session.totalDraggedHeight).toBe(0);
    });

    test('supports group ids via data-group-id selector', () => {
        const { root } = makeRoot([
            { key: 'g1', attr: 'data-group-id', height: 80 }
        ]);

        const session = api.prepareDragSession({
            draggedKeys: ['g1'],
            rootElement: root
        });
        expect(session.itemHeights.get('g1')).toBe(80);
        expect(session.totalDraggedHeight).toBe(80);
    });

    test('keeps source and group identities separate when their raw keys collide', () => {
        const createElement = (attribute, height) => {
            const classes = new Set();
            return {
                offsetHeight: height,
                style: {
                    height: '',
                    opacity: ''
                },
                classList: {
                    add: (name) => classes.add(name),
                    remove: (name) => classes.delete(name),
                    contains: (name) => classes.has(name)
                },
                getAttribute: (name) => (
                    name === attribute ? 'collision' : null
                ),
                getBoundingClientRect: jest.fn(() => ({
                    top: 0,
                    bottom: height,
                    left: 0,
                    right: 200,
                    width: 200,
                    height
                }))
            };
        };
        const sourceElement = createElement('data-source-key', 40);
        const groupElement = createElement('data-group-id', 120);
        const root = {
            contains: jest.fn((element) => (
                element === sourceElement || element === groupElement
            )),
            querySelector: jest.fn((selector) => (
                selector === '[data-source-key="collision"]'
                    ? sourceElement
                    : (
                        selector === '[data-group-id="collision"]'
                            ? groupElement
                            : null
                    )
            ))
        };

        const sourceSession = api.prepareDragSession({
            draggedKeys: ['collision'],
            originKey: 'collision',
            draggedType: 'source',
            rootElement: root
        });
        const groupSession = api.prepareDragSession({
            draggedKeys: ['collision'],
            originKey: 'collision',
            draggedType: 'group',
            rootElement: root
        });

        expect(sourceSession.draggedType).toBe('source');
        expect(sourceSession.itemHeights.get('collision')).toBe(40);
        expect(sourceSession.itemMetrics.get('collision').visualRect.height).toBe(40);
        expect(groupSession.draggedType).toBe('group');
        expect(groupSession.itemHeights.get('collision')).toBe(120);
        expect(groupSession.itemMetrics.get('collision').visualRect.height).toBe(120);

        api.foldDraggedItems({ session: sourceSession, rootElement: root });
        expect(sourceElement.classList.contains('sp-drag-folded')).toBe(true);
        expect(groupElement.classList.contains('sp-drag-folded')).toBe(false);
        api.unfoldDraggedItems({
            session: sourceSession,
            rootElement: root,
            animated: false
        });
        expect(sourceElement.classList.contains('sp-drag-folded')).toBe(false);

        api.foldDraggedItems({ session: groupSession, rootElement: root });
        expect(groupElement.classList.contains('sp-drag-folded')).toBe(true);
        expect(sourceElement.classList.contains('sp-drag-folded')).toBe(false);
        api.unfoldDraggedItems({
            session: groupSession,
            rootElement: root,
            animated: false
        });
        expect(groupElement.classList.contains('sp-drag-folded')).toBe(false);
    });

    test.each([
        ['content-box', 38],
        ['border-box', 50]
    ])('measures %s unfold height from the real box model', (boxSizing, expectedUnfoldHeight) => {
        const { root, items } = makeRoot([{
            key: 'box',
            attr: 'data-source-key',
            height: 50,
            computedStyle: {
                boxSizing,
                marginTop: '4px',
                marginBottom: '6px',
                paddingTop: '3px',
                paddingBottom: '5px',
                borderTopWidth: '2px',
                borderBottomWidth: '2px'
            }
        }]);
        const getComputedStyle = jest.fn((element) => element.computedStyle);
        const boxApi = createContentDragReflow({ getComputedStyle });

        const session = boxApi.prepareDragSession({
            draggedKeys: ['box'],
            rootElement: root
        });

        expect(session.itemMetrics.get('box')).toEqual(expect.objectContaining({
            borderBoxHeight: 50,
            contentHeight: 38,
            marginTop: 4,
            marginBottom: 6,
            unfoldHeight: expectedUnfoldHeight
        }));
        expect(session.itemHeights.get('box')).toBe(50);
        expect(getComputedStyle).toHaveBeenCalledWith(items.box);
    });

    test('falls back to offsetHeight when getComputedStyle is unavailable', () => {
        const originalGetComputedStyle = globalThis.getComputedStyle;
        delete globalThis.getComputedStyle;
        try {
            const { root } = makeRoot([
                { key: 'fallback', attr: 'data-source-key', height: 57 }
            ]);
            const fallbackApi = createContentDragReflow({ now: () => 0 });

            const session = fallbackApi.prepareDragSession({
                draggedKeys: ['fallback'],
                rootElement: root
            });

            expect(session.itemHeights.get('fallback')).toBe(57);
            expect(session.itemMetrics.get('fallback')).toEqual(expect.objectContaining({
                borderBoxHeight: 57,
                contentHeight: 57,
                unfoldHeight: 57
            }));
            expect(session.totalDraggedHeight).toBe(57);
        } finally {
            if (originalGetComputedStyle === undefined) {
                delete globalThis.getComputedStyle;
            } else {
                globalThis.getComputedStyle = originalGetComputedStyle;
            }
        }
    });

    test('reads a fresh visual rect only for the explicit origin and exposes prepared elements', () => {
        const { root, items } = makeRoot([
            { key: 'selected-first', attr: 'data-source-key', height: 48 },
            { key: 'actual-origin', attr: 'data-source-key', height: 52 },
            { key: 'selected-last', attr: 'data-source-key', height: 56 }
        ]);
        Object.entries(items).forEach(([key, element], index) => {
            element.getBoundingClientRect = jest.fn(() => ({
                top: index * 60,
                bottom: index * 60 + element.offsetHeight,
                left: 10,
                right: 210,
                width: 200,
                height: element.offsetHeight
            }));
            element.getAttribute = (name) => (
                name === 'data-source-key' ? key : null
            );
        });
        root.contains = jest.fn((element) => Object.values(items).includes(element));

        const session = api.prepareDragSession({
            draggedKeys: ['selected-first', 'actual-origin', 'selected-last'],
            originKey: 'actual-origin',
            rootElement: root
        });

        expect(items['selected-first'].getBoundingClientRect).not.toHaveBeenCalled();
        expect(items['actual-origin'].getBoundingClientRect).toHaveBeenCalledTimes(1);
        expect(items['selected-last'].getBoundingClientRect).not.toHaveBeenCalled();
        expect(session.itemMetrics.get('selected-first').visualRect).toBeNull();
        expect(session.itemMetrics.get('actual-origin').visualRect).toMatchObject({
            top: 60,
            height: 52
        });
        expect(session.itemMetrics.get('selected-last').visualRect).toBeNull();
        expect(session.preparedElements.get('actual-origin')).toBe(items['actual-origin']);
    });

    test.each([
        {
            name: 'is not part of the requested drag keys',
            originKey: 'not-selected',
            detachOrigin: false,
            removeOrigin: false
        },
        {
            name: 'cannot be resolved to an element',
            originKey: 'actual-origin',
            detachOrigin: false,
            removeOrigin: true
        },
        {
            name: 'resolves to an element detached from the root',
            originKey: 'actual-origin',
            detachOrigin: true,
            removeOrigin: false
        }
    ])('falls back to reading every available visual rect when origin $name', ({
        originKey,
        detachOrigin,
        removeOrigin
    }) => {
        const { root, items } = makeRoot([
            { key: 'selected-first', attr: 'data-source-key', height: 48 },
            { key: 'actual-origin', attr: 'data-source-key', height: 52 },
            { key: 'selected-last', attr: 'data-source-key', height: 56 }
        ]);
        Object.entries(items).forEach(([key, element], index) => {
            element.getBoundingClientRect = jest.fn(() => ({
                top: index * 60,
                bottom: index * 60 + element.offsetHeight,
                left: 10,
                right: 210,
                width: 200,
                height: element.offsetHeight
            }));
            element.getAttribute = (name) => (
                name === 'data-source-key' ? key : null
            );
        });
        root.contains = jest.fn((element) => (
            Object.values(items).includes(element)
            && !(detachOrigin && element === items['actual-origin'])
        ));
        if (removeOrigin) {
            const querySelector = root.querySelector.getMockImplementation();
            root.querySelector.mockImplementation((selector) => (
                selector.includes('"actual-origin"') ? null : querySelector(selector)
            ));
        }

        const session = api.prepareDragSession({
            draggedKeys: ['selected-first', 'actual-origin', 'selected-last'],
            originKey,
            rootElement: root
        });

        expect(items['selected-first'].getBoundingClientRect).toHaveBeenCalledTimes(1);
        expect(items['selected-last'].getBoundingClientRect).toHaveBeenCalledTimes(1);
        if (removeOrigin) {
            expect(items['actual-origin'].getBoundingClientRect).not.toHaveBeenCalled();
            expect(session.itemMetrics.get('actual-origin').visualRect).toEqual({
                top: 0,
                bottom: 0,
                left: 0,
                right: 0,
                width: 0,
                height: 0
            });
        } else {
            expect(items['actual-origin'].getBoundingClientRect).toHaveBeenCalledTimes(1);
            expect(session.itemMetrics.get('actual-origin').visualRect).toMatchObject({
                top: 60,
                height: 52
            });
        }
    });

    test('falls back without claiming forced layout phases when the mock has no layout tree', () => {
        const selected = Array.from({ length: 50 }, (_, index) => ({
            key: `k${index + 1}`,
            attr: 'data-source-key',
            height: 48
        }));
        const { root } = makeRoot(selected);

        const session = api.prepareDragSession({
            draggedKeys: selected.map((item) => item.key),
            rootElement: root
        });

        expect(session.probeMetrics).toEqual(expect.objectContaining({
            forcedLayoutReadPhases: expect.any(Number),
            prepareCpuMs: expect.any(Number)
        }));
        expect(session.probeMetrics.forcedLayoutReadPhases).toBe(0);
        expect(session.draggedRuns).toEqual([]);
        expect(session.totalDraggedHeight).toBe(50 * 48);
    });

    test('invalidates cached metrics when an existing row geometry changes', () => {
        const { root, items } = makeRoot([
            { key: 'mutable', attr: 'data-source-key', height: 48 }
        ]);

        const before = api.prepareDragSession({
            draggedKeys: ['mutable'],
            rootElement: root
        });
        items.mutable.offsetHeight = 72;
        const after = api.prepareDragSession({
            draggedKeys: ['mutable'],
            rootElement: root
        });

        expect(before.itemHeights.get('mutable')).toBe(48);
        expect(after.itemHeights.get('mutable')).toBe(72);
        expect(after.itemMetrics.get('mutable')).not.toBe(before.itemMetrics.get('mutable'));
    });

    test('reuses connected source rows and refreshes a replaced cached row', () => {
        const createRow = (key, height) => ({
            offsetHeight: height,
            style: { height: '', opacity: '' },
            classList: {
                add() {},
                remove() {},
                contains() { return false; }
            },
            getAttribute(name) {
                return name === 'data-source-key' ? key : null;
            },
            parentElement: null
        });
        const keys = Array.from({ length: 8 }, (_, index) => `k${index + 1}`);
        let liveRows = keys.map((key) => createRow(key, 48));
        const root = {
            contains: jest.fn((row) => liveRows.includes(row)),
            querySelectorAll: jest.fn((selector) => liveRows.filter((row) => (
                selector.includes(`[data-source-key="${row.getAttribute('data-source-key')}"]`)
            ))),
            querySelector: jest.fn((selector) => {
                const match = selector.match(/^\[data-source-key="(.*)"\]$/);
                return match
                    ? liveRows.find((row) => row.getAttribute('data-source-key') === match[1]) || null
                    : null;
            })
        };

        api.prepareDragSession({ draggedKeys: keys, rootElement: root });
        const firstQueryCount = root.querySelectorAll.mock.calls.length;
        api.prepareDragSession({ draggedKeys: keys, rootElement: root });

        expect(root.querySelectorAll).toHaveBeenCalledTimes(firstQueryCount);

        const replacement = createRow('k8', 72);
        liveRows = liveRows.slice(0, -1).concat(replacement);
        const refreshed = api.prepareDragSession({ draggedKeys: keys, rootElement: root });

        expect(root.querySelectorAll).toHaveBeenCalledTimes(firstQueryCount + 1);
        expect(root.querySelectorAll.mock.calls.at(-1)[0]).toBe('[data-source-key="k8"]');
        expect(refreshed.itemHeights.get('k8')).toBe(72);
    });

    test.each([
        ['first-item successor survivor', 'first'],
        ['middle successor survivor', 'middle'],
        ['last-item container-end sentinel', 'last'],
        ['only-child container-end sentinel', 'only']
    ])('uses %s scripted displacement', (_label, placement) => {
        const probe = makeProbeLayoutRoot({ placement });
        const probeApi = createContentDragReflow({
            getComputedStyle: (element) => element.computedStyle,
            now: () => 10
        });

        const session = probeApi.prepareDragSession({
            draggedKeys: ['drag'],
            rootElement: probe.root
        });

        expect(session.totalDraggedHeight).toBeCloseTo(48, 6);
        expect(session.draggedRuns).toEqual([
            expect.objectContaining({
                keys: ['drag'],
                hostElement: probe.root,
                cumulativeDisplacement: 48,
                footprint: 48
            })
        ]);
        expect(probe.layoutState.forcedLayoutReadPhases).toBeLessThanOrEqual(3);
        expect(probe.createdNodes).toHaveLength(
            placement === 'last' || placement === 'only' ? 1 : 0
        );
        expect(probe.createdNodes.every((node) => (
            !node.hasAttribute('data-source-key') && !node.hasAttribute('data-group-id')
        ))).toBe(true);
        expect(probe.createdNodes.every((node) => node.parentElement === null)).toBe(true);
    });

    test('uses a root outer sentinel for a terminal nested-only selection', () => {
        const probe = makeProbeLayoutRoot({
            placement: 'only',
            rectsByLabel: {
                root: {
                    before: { top: 100, bottom: 420, height: 320 },
                    after: { top: 100, bottom: 420, height: 320 },
                    settle: { top: 100, bottom: 420, height: 320 }
                },
                'final-host': {
                    before: { top: 180, bottom: 300, height: 120 },
                    after: { top: 180, bottom: 300, height: 120 },
                    settle: { top: 180, bottom: 300, height: 120 }
                },
                drag: {
                    before: { top: 252, bottom: 300, height: 48 },
                    after: { top: 252, bottom: 252, height: 0 },
                    settle: { top: 252, bottom: 300, height: 48 }
                },
                'final-host:sentinel': {
                    before: { top: 300, bottom: 300, height: 0 },
                    after: { top: 252, bottom: 252, height: 0 },
                    settle: { top: 300, bottom: 300, height: 0 }
                },
                'root:sentinel': {
                    before: { top: 420, bottom: 420, height: 0 },
                    after: { top: 420, bottom: 420, height: 0 },
                    settle: { top: 420, bottom: 420, height: 0 }
                }
            }
        });
        const finalGroup = probe.createNode('final-group', {
            'data-group-id': 'final-group'
        });
        const finalHost = probe.createNode('final-host');
        finalGroup.ownerDocument = probe.document;
        finalHost.ownerDocument = probe.document;
        probe.root.removeChild(probe.drag);
        probe.root.appendChild(finalGroup);
        finalGroup.appendChild(finalHost);
        finalHost.appendChild(probe.drag);
        probe.operationLog.length = 0;
        probe.layoutState.pendingWrite = false;
        probe.layoutState.forcedLayoutReadPhases = 0;
        probe.layoutState.sawFoldedEndState = false;

        const probeApi = createContentDragReflow({
            getComputedStyle: (element) => element.computedStyle
        });
        const session = probeApi.prepareDragSession({
            draggedKeys: ['drag'],
            rootElement: probe.root
        });

        expect(session.totalDraggedHeight).toBe(48);
        expect(session.draggedRuns).toEqual([
            expect.objectContaining({
                keys: ['drag'],
                hostElement: finalHost,
                cumulativeDisplacement: 48,
                footprint: 48
            })
        ]);
        expect(session.probeMetrics.forcedLayoutReadPhases).toBe(3);
        expect(probe.createdNodes).toHaveLength(2);
        expect(probe.createdNodes.every((node) => node.parentElement === null)).toBe(true);
    });

    test('does not subtract contained child shrink from a later root run', () => {
        const probe = makeProbeLayoutRoot({
            placement: 'only',
            selectedKeys: ['nested-drag', 'root-drag'],
            rectsByLabel: {
                root: {
                    before: { top: 100, bottom: 340, height: 240 },
                    after: { top: 100, bottom: 292, height: 192 },
                    settle: { top: 100, bottom: 340, height: 240 }
                },
                group: {
                    before: { top: 100, bottom: 228, height: 128 },
                    after: { top: 100, bottom: 228, height: 128 },
                    settle: { top: 100, bottom: 228, height: 128 }
                },
                'group-host': {
                    before: { top: 180, bottom: 228, height: 48 },
                    after: { top: 180, bottom: 228, height: 48 },
                    settle: { top: 180, bottom: 228, height: 48 }
                },
                'nested-drag': {
                    before: { top: 180, bottom: 228, height: 48 },
                    after: { top: 180, bottom: 180, height: 0 },
                    settle: { top: 180, bottom: 228, height: 48 }
                },
                'group-host:sentinel': {
                    before: { top: 228, bottom: 228, height: 0 },
                    after: { top: 180, bottom: 180, height: 0 },
                    settle: { top: 228, bottom: 228, height: 0 }
                },
                'root-drag': {
                    before: { top: 236, bottom: 284, height: 48 },
                    after: { top: 236, bottom: 236, height: 0 },
                    settle: { top: 236, bottom: 284, height: 48 }
                },
                'root-next': {
                    before: { top: 292, bottom: 340, height: 48 },
                    after: { top: 244, bottom: 292, height: 48 },
                    settle: { top: 292, bottom: 340, height: 48 }
                }
            }
        });
        while (probe.root.children.length) {
            probe.root.removeChild(probe.root.children[0]);
        }
        const create = (label, attributes = {}, options = {}) => {
            const node = probe.createNode(label, attributes, options);
            node.ownerDocument = probe.document;
            return node;
        };
        const group = create('group', { 'data-group-id': 'group' }, { offsetHeight: 128 });
        const groupHost = create('group-host');
        const nestedDrag = create(
            'nested-drag',
            { 'data-source-key': 'nested-drag' },
            { offsetHeight: 48 }
        );
        const rootDrag = create(
            'root-drag',
            { 'data-source-key': 'root-drag' },
            { offsetHeight: 48 }
        );
        const rootNext = create(
            'root-next',
            { 'data-source-key': 'root-next' },
            { offsetHeight: 48 }
        );
        groupHost.appendChild(nestedDrag);
        group.appendChild(groupHost);
        probe.root.appendChild(group);
        probe.root.appendChild(rootDrag);
        probe.root.appendChild(rootNext);
        probe.operationLog.length = 0;
        probe.layoutState.pendingWrite = false;
        probe.layoutState.forcedLayoutReadPhases = 0;
        probe.layoutState.sawFoldedEndState = false;

        const probeApi = createContentDragReflow({
            getComputedStyle: (element) => element.computedStyle
        });
        const session = probeApi.prepareDragSession({
            draggedKeys: ['nested-drag', 'root-drag'],
            rootElement: probe.root
        });

        expect(session.totalDraggedHeight).toBe(96);
        expect(session.draggedRuns.map((run) => ({
            keys: run.keys,
            footprint: run.footprint
        }))).toEqual([
            { keys: ['nested-drag'], footprint: 48 },
            { keys: ['root-drag'], footprint: 48 }
        ]);
        expect(session.probeMetrics.forcedLayoutReadPhases).toBe(3);
        expect(probe.createdNodes).toHaveLength(1);
        expect(probe.createdNodes[0].parentElement).toBeNull();
    });

    test('merges a contiguous selection into one measured run', () => {
        const probe = makeProbeLayoutRoot({
            selectedKeys: ['drag', 'next'],
            rectsByLabel: {
                root: {
                    before: { top: 100, bottom: 252, height: 152 },
                    after: { top: 100, bottom: 156, height: 56 },
                    settle: { top: 100, bottom: 252, height: 152 }
                },
                sentinel: {
                    before: { top: 252, bottom: 252, height: 0 },
                    after: { top: 156, bottom: 156, height: 0 },
                    settle: { top: 252, bottom: 252, height: 0 }
                }
            }
        });
        const probeApi = createContentDragReflow({
            getComputedStyle: (element) => element.computedStyle
        });

        const session = probeApi.prepareDragSession({
            draggedKeys: ['drag', 'next'],
            rootElement: probe.root
        });

        expect(session.totalDraggedHeight).toBe(96);
        expect(session.draggedRuns).toHaveLength(1);
        expect(session.draggedRuns[0]).toEqual(expect.objectContaining({
            keys: ['drag', 'next'],
            cumulativeDisplacement: 96,
            footprint: 96
        }));
        expect(session.probeMetrics.forcedLayoutReadPhases).toBeLessThanOrEqual(3);
    });

    test('splits non-contiguous items and derives adjacent cumulative footprints', () => {
        const probe = makeProbeLayoutRoot({
            selectedKeys: ['prev', 'next'],
            rectsByLabel: {
                drag: {
                    before: { top: 148, bottom: 196, height: 48 },
                    after: { top: 108, bottom: 156, height: 48 },
                    settle: { top: 148, bottom: 196, height: 48 }
                },
                root: {
                    before: { top: 100, bottom: 252, height: 152 },
                    after: { top: 100, bottom: 164, height: 64 },
                    settle: { top: 100, bottom: 252, height: 152 }
                },
                sentinel: {
                    before: { top: 252, bottom: 252, height: 0 },
                    after: { top: 164, bottom: 164, height: 0 },
                    settle: { top: 252, bottom: 252, height: 0 }
                }
            }
        });
        const probeApi = createContentDragReflow({
            getComputedStyle: (element) => element.computedStyle
        });

        const session = probeApi.prepareDragSession({
            draggedKeys: ['prev', 'next'],
            rootElement: probe.root
        });

        expect(session.totalDraggedHeight).toBe(88);
        expect(session.draggedRuns.map((run) => ({
            keys: run.keys,
            cumulativeDisplacement: run.cumulativeDisplacement,
            footprint: run.footprint
        }))).toEqual([
            { keys: ['prev'], cumulativeDisplacement: 40, footprint: 40 },
            { keys: ['next'], cumulativeDisplacement: 88, footprint: 48 }
        ]);
        expect(session.probeMetrics.forcedLayoutReadPhases).toBeLessThanOrEqual(3);
    });

    test('dedupes a nested host contribution from an ancestor run', () => {
        const probe = makeProbeLayoutRoot({
            placement: 'only',
            selectedKeys: ['group-a', 'group-b', 'root-drag'],
            rectsByLabel: {
                root: {
                    before: { top: 100, bottom: 420, height: 320 },
                    after: { top: 100, bottom: 276, height: 176 },
                    settle: { top: 100, bottom: 420, height: 320 }
                },
                pre: {
                    before: { top: 100, bottom: 140, height: 40 },
                    after: { top: 100, bottom: 140, height: 40 },
                    settle: { top: 100, bottom: 140, height: 40 }
                },
                group: {
                    before: { top: 148, bottom: 308, height: 160 },
                    after: { top: 148, bottom: 212, height: 64 },
                    settle: { top: 148, bottom: 308, height: 160 }
                },
                'group-host': {
                    before: { top: 180, bottom: 300, height: 120 },
                    after: { top: 180, bottom: 204, height: 24 },
                    settle: { top: 180, bottom: 300, height: 120 }
                },
                'group-a': {
                    before: { top: 180, bottom: 228, height: 48 },
                    after: { top: 180, bottom: 180, height: 0 },
                    settle: { top: 180, bottom: 228, height: 48 }
                },
                'group-b': {
                    before: { top: 236, bottom: 284, height: 48 },
                    after: { top: 180, bottom: 180, height: 0 },
                    settle: { top: 236, bottom: 284, height: 48 }
                },
                'root-drag': {
                    before: { top: 316, bottom: 364, height: 48 },
                    after: { top: 220, bottom: 220, height: 0 },
                    settle: { top: 316, bottom: 364, height: 48 }
                },
                'root-next': {
                    before: { top: 372, bottom: 420, height: 48 },
                    after: { top: 228, bottom: 276, height: 48 },
                    settle: { top: 372, bottom: 420, height: 48 }
                },
                'group-host:sentinel': {
                    before: { top: 300, bottom: 300, height: 0 },
                    after: { top: 204, bottom: 204, height: 0 },
                    settle: { top: 300, bottom: 300, height: 0 }
                },
                'root:sentinel': {
                    before: { top: 420, bottom: 420, height: 0 },
                    after: { top: 276, bottom: 276, height: 0 },
                    settle: { top: 420, bottom: 420, height: 0 }
                }
            }
        });
        while (probe.root.children.length) {
            probe.root.removeChild(probe.root.children[0]);
        }
        const create = (label, attributes = {}, options = {}) => {
            const node = probe.createNode(label, attributes, options);
            node.ownerDocument = probe.document;
            return node;
        };
        const pre = create('pre', { 'data-source-key': 'pre' }, { offsetHeight: 40 });
        const group = create('group', { 'data-group-id': 'group' }, { offsetHeight: 160 });
        const groupHost = create('group-host');
        const groupA = create('group-a', { 'data-source-key': 'group-a' }, { offsetHeight: 48 });
        const groupB = create('group-b', { 'data-source-key': 'group-b' }, { offsetHeight: 48 });
        const rootDrag = create('root-drag', { 'data-source-key': 'root-drag' }, { offsetHeight: 48 });
        const rootNext = create('root-next', { 'data-source-key': 'root-next' }, { offsetHeight: 48 });
        groupHost.appendChild(groupA);
        groupHost.appendChild(groupB);
        group.appendChild(groupHost);
        probe.root.appendChild(pre);
        probe.root.appendChild(group);
        probe.root.appendChild(rootDrag);
        probe.root.appendChild(rootNext);
        probe.operationLog.length = 0;
        probe.layoutState.pendingWrite = false;
        probe.layoutState.forcedLayoutReadPhases = 0;
        probe.layoutState.sawFoldedEndState = false;

        const probeApi = createContentDragReflow({
            getComputedStyle: (element) => element.computedStyle
        });
        const session = probeApi.prepareDragSession({
            draggedKeys: ['group-a', 'group-b', 'root-drag'],
            rootElement: probe.root
        });

        expect(session.totalDraggedHeight).toBe(144);
        expect(session.draggedRuns).toEqual([
            expect.objectContaining({
                keys: ['group-a', 'group-b'],
                cumulativeDisplacement: 96,
                footprint: 96
            }),
            expect.objectContaining({
                keys: ['root-drag'],
                cumulativeDisplacement: 48,
                footprint: 48
            })
        ]);
        expect(session.draggedRuns.reduce((sum, run) => sum + run.footprint, 0)).toBe(144);
        expect(session.probeMetrics.forcedLayoutReadPhases).toBe(3);
        expect(probe.layoutState.forcedLayoutReadPhases).toBeLessThanOrEqual(3);
        expect(probe.createdNodes).toHaveLength(1);
        expect(probe.createdNodes.every((node) => node.parentElement === null)).toBe(true);
    });

    test('restores a scroll host after the folded probe clamps its scrollTop', () => {
        const probe = makeProbeLayoutRoot({ placement: 'last' });
        let scrollTop = 120;
        Object.defineProperty(probe.root, 'scrollTop', {
            configurable: true,
            get() {
                return scrollTop;
            },
            set(value) {
                scrollTop = Number(value);
            }
        });
        const originalRootRect = probe.root.getBoundingClientRect.bind(probe.root);
        probe.root.getBoundingClientRect = () => {
            const rect = originalRootRect();
            if (
                probe.drag.style.height === '0px'
                || probe.drag.classList.contains('sp-drag-folded')
            ) {
                scrollTop = 24;
            }
            return rect;
        };
        const probeApi = createContentDragReflow({
            getComputedStyle: (element) => element.computedStyle
        });

        probeApi.prepareDragSession({
            draggedKeys: ['drag'],
            rootElement: probe.root
        });

        expect(scrollTop).toBe(120);
        expect(probe.root.style.getPropertyValue('overflow-anchor')).toBe('');
    });

    test('restores probe motion priorities, inline box values, and class membership after settle read', () => {
        const probe = makeProbeLayoutRoot({ placement: 'last' });
        const probeApi = createContentDragReflow({
            getComputedStyle: (element) => element.computedStyle
        });

        probeApi.prepareDragSession({
            draggedKeys: ['drag'],
            rootElement: probe.root
        });

        expect(probe.drag.style.height).toBe('17px');
        expect(probe.drag.style.opacity).toBe('0.65');
        expect(probe.drag.style.getPropertyValue('transition')).toBe('height 180ms ease');
        expect(probe.drag.style.getPropertyPriority('transition')).toBe('important');
        expect(probe.drag.style.getPropertyValue('animation')).toBe('fixture-pulse 1s linear');
        expect(probe.drag.style.getPropertyPriority('animation')).toBe('');
        expect(probe.drag.style.getPropertyValue('overflow-anchor')).toBe('auto');
        expect(probe.drag.style.getPropertyPriority('overflow-anchor')).toBe('important');
        expect(probe.drag.classList.contains('pre-existing')).toBe(true);
        expect(probe.drag.classList.contains('sp-drag-unfolding')).toBe(true);
        expect(probe.drag.classList.contains('sp-drag-folded')).toBe(false);
        expect(probe.drag.getAnimations()).toEqual([]);

        const transitionOffIndex = probe.operationLog.findIndex(
            (entry) => entry === 'drag:style:transition=none!important'
        );
        const animationOffIndex = probe.operationLog.findIndex(
            (entry) => entry === 'drag:style:animation=none!important'
        );
        const lastBeforeReadIndex = probe.operationLog.findLastIndex(
            (entry) => entry.endsWith(':rect:before')
        );
        const firstFoldWriteIndex = probe.operationLog.findIndex(
            (entry) => entry.includes('drag:style:height=0px')
        );
        const firstAfterReadIndex = probe.operationLog.findIndex(
            (entry) => entry.endsWith(':rect:after')
        );
        const lastAfterReadIndex = probe.operationLog.findLastIndex(
            (entry) => entry.endsWith(':rect:after')
        );
        const restoredBoxIndex = probe.operationLog.findIndex(
            (entry) => entry === 'drag:style:height=17px!'
        );
        const sentinelRemovalIndex = probe.operationLog.findLastIndex(
            (entry) => entry.includes(':remove:sentinel-')
        );
        const settleReadIndex = probe.operationLog.findLastIndex(
            (entry) => entry === 'drag:rect:settle'
        );
        const restoredMotionIndex = probe.operationLog.findLastIndex(
            (entry) => entry === 'drag:style:transition=height 180ms ease!important'
        );

        expect(transitionOffIndex).toBeGreaterThanOrEqual(0);
        expect(animationOffIndex).toBeGreaterThanOrEqual(0);
        expect(transitionOffIndex).toBeGreaterThan(lastBeforeReadIndex);
        expect(animationOffIndex).toBeGreaterThan(lastBeforeReadIndex);
        expect(firstFoldWriteIndex).toBeGreaterThan(lastBeforeReadIndex);
        expect(firstFoldWriteIndex).toBeGreaterThan(transitionOffIndex);
        expect(firstFoldWriteIndex).toBeGreaterThan(animationOffIndex);
        expect(firstAfterReadIndex).toBeGreaterThan(firstFoldWriteIndex);
        expect(restoredBoxIndex).toBeGreaterThan(lastAfterReadIndex);
        expect(sentinelRemovalIndex).toBeGreaterThan(restoredBoxIndex);
        expect(restoredBoxIndex).toBeGreaterThanOrEqual(0);
        expect(settleReadIndex).toBeGreaterThan(sentinelRemovalIndex);
        expect(restoredMotionIndex).toBeGreaterThan(settleReadIndex);
        expect(probe.layoutState.forcedLayoutReadPhases).toBeLessThanOrEqual(3);
    });
});

describe('foldDraggedItems / unfoldDraggedItems', () => {
    let api;
    beforeEach(() => {
        api = createContentDragReflow();
    });

    test('foldDraggedItems sets inline height=0 + opacity=0 + class', () => {
        const { root, items } = makeRoot([
            { key: 'k1', attr: 'data-source-key', height: 48 }
        ]);
        const session = api.prepareDragSession({ draggedKeys: ['k1'], rootElement: root });
        api.foldDraggedItems({ session, rootElement: root });
        expect(items.k1.style.height).toBe('0px');
        expect(items.k1.style.opacity).toBe('0');
        expect(items.k1.classList.contains('sp-drag-folded')).toBe(true);
    });

    test('unfoldDraggedItems restores height/opacity and removes class', () => {
        const { root, items } = makeRoot([
            { key: 'k1', attr: 'data-source-key', height: 48 }
        ]);
        const session = api.prepareDragSession({ draggedKeys: ['k1'], rootElement: root });
        api.foldDraggedItems({ session, rootElement: root });
        api.unfoldDraggedItems({ session, rootElement: root });
        expect(items.k1.style.height).toBe('');
        expect(items.k1.style.opacity).toBe('');
        expect(items.k1.classList.contains('sp-drag-folded')).toBe(false);
    });

    test('animated cancel restores original inline height/opacity after its timeout', () => {
        jest.useFakeTimers();
        try {
            const { root, items } = makeRoot([{
                key: 'k1',
                attr: 'data-source-key',
                height: 48,
                inlineStyle: {
                    height: '17px',
                    opacity: '0.65'
                }
            }]);
            const session = api.prepareDragSession({ draggedKeys: ['k1'], rootElement: root });

            api.foldDraggedItems({ session, rootElement: root });
            api.unfoldDraggedItems({ session, rootElement: root, animated: true });
            jest.advanceTimersByTime(api.TRANSITION_MS + 80);

            expect(items.k1.style.height).toBe('17px');
            expect(items.k1.style.opacity).toBe('0.65');
            expect(items.k1.classList.contains('sp-drag-folded')).toBe(false);
            expect(items.k1.classList.contains('sp-drag-unfolding')).toBe(false);
        } finally {
            jest.useRealTimers();
        }
    });

    test('animated:false restores original inline height/opacity immediately', () => {
        const { root, items } = makeRoot([{
            key: 'k1',
            attr: 'data-source-key',
            height: 48,
            inlineStyle: {
                height: '17px',
                opacity: '0.65'
            }
        }]);
        const session = api.prepareDragSession({ draggedKeys: ['k1'], rootElement: root });

        api.foldDraggedItems({ session, rootElement: root });
        api.unfoldDraggedItems({ session, rootElement: root, animated: false });

        expect(items.k1.style.height).toBe('17px');
        expect(items.k1.style.opacity).toBe('0.65');
        expect(items.k1.classList.contains('sp-drag-folded')).toBe(false);
        expect(items.k1.classList.contains('sp-drag-unfolding')).toBe(false);
    });
});

describe('computeReflow', () => {
    let api;
    beforeEach(() => {
        api = createContentDragReflow();
    });

    function makeFourSourceRoot() {
        return makeRoot([
            { key: 'a', attr: 'data-source-key', height: 48 },
            { key: 'b', attr: 'data-source-key', height: 48 },
            { key: 'c', attr: 'data-source-key', height: 48 },
            { key: 'd', attr: 'data-source-key', height: 48 }
        ]);
    }

    test('single source dragged: items after insertIndex shift by itemHeight', () => {
        const { root } = makeFourSourceRoot();
        const session = api.prepareDragSession({ draggedKeys: ['a'], rootElement: root });
        const shifts = api.computeReflow({
            session, insertIndex: 2,
            siblingKeys: ['a', 'b', 'c', 'd'], rootElement: root
        });
        // 'a' is dragged → skipped
        // 'b' at idx 1 < 2 → not shifted
        // 'c' at idx 2 >= 2 → shift by 48
        // 'd' at idx 3 >= 2 → shift by 48
        expect(shifts.get('a')).toBeUndefined();
        expect(shifts.get('b')).toBeUndefined();
        expect(shifts.get('c')).toBe(48);
        expect(shifts.get('d')).toBe(48);
    });

    test('multi source dragged: shift by N * itemHeight', () => {
        const { root } = makeFourSourceRoot();
        const session = api.prepareDragSession({ draggedKeys: ['a', 'b'], rootElement: root });
        const shifts = api.computeReflow({
            session, insertIndex: 3,
            siblingKeys: ['a', 'b', 'c', 'd'], rootElement: root
        });
        expect(shifts.get('a')).toBeUndefined();
        expect(shifts.get('b')).toBeUndefined();
        expect(shifts.get('c')).toBeUndefined();
        expect(shifts.get('d')).toBe(96);
    });

    test('insertIndex past end: nothing shifted', () => {
        const { root } = makeFourSourceRoot();
        const session = api.prepareDragSession({ draggedKeys: ['a'], rootElement: root });
        const shifts = api.computeReflow({
            session, insertIndex: 4,
            siblingKeys: ['a', 'b', 'c', 'd'], rootElement: root
        });
        expect(shifts.size).toBe(0);
    });
});

describe('applyReflow / clearReflow', () => {
    let api;
    beforeEach(() => {
        api = createContentDragReflow();
    });

    test('applyReflow writes transform and tracks shiftedItems', () => {
        const { root, items } = makeRoot([{ key: 'x', attr: 'data-source-key', height: 48 }]);
        const session = api.prepareDragSession({ draggedKeys: [], rootElement: root });
        const shifts = new Map([['x', 48]]);
        api.applyReflow({ session, shifts, rootElement: root });

        expect(items.x.style.transform).toBe('translateY(48px)');
        expect(items.x.classList.contains('sp-drop-shift')).toBe(true);
        expect(session.shiftedItems.get('x')).toBe(48);
    });

    test('applyReflow diffs: unchanged items are not rewritten', () => {
        const { root, items } = makeRoot([{ key: 'x', attr: 'data-source-key', height: 48 }]);
        const session = api.prepareDragSession({ draggedKeys: [], rootElement: root });
        const shifts1 = new Map([['x', 48]]);
        api.applyReflow({ session, shifts: shifts1, rootElement: root });

        // Externally clobber transform; applyReflow with identical shifts should NOT re-write
        items.x.style.transform = 'translateY(999px)';
        api.applyReflow({ session, shifts: shifts1, rootElement: root });
        expect(items.x.style.transform).toBe('translateY(999px)');
    });

    test('applyReflow clears removed items', () => {
        const { root, items } = makeRoot([
            { key: 'x', attr: 'data-source-key', height: 48 },
            { key: 'y', attr: 'data-source-key', height: 48 }
        ]);
        const session = api.prepareDragSession({ draggedKeys: [], rootElement: root });
        api.applyReflow({ session, shifts: new Map([['x', 48], ['y', 48]]), rootElement: root });
        api.applyReflow({ session, shifts: new Map([['x', 48]]), rootElement: root });

        expect(items.x.style.transform).toBe('translateY(48px)');
        expect(items.y.style.transform).toBe('');
        expect(items.y.classList.contains('sp-drop-shift')).toBe(false);
    });

    test('clearReflow zeros all transforms', () => {
        const { root, items } = makeRoot([{ key: 'x', attr: 'data-source-key', height: 48 }]);
        const session = api.prepareDragSession({ draggedKeys: [], rootElement: root });
        api.applyReflow({ session, shifts: new Map([['x', 48]]), rootElement: root });
        api.clearReflow({ session, rootElement: root });

        expect(items.x.style.transform).toBe('');
        expect(items.x.classList.contains('sp-drop-shift')).toBe(false);
        expect(session.shiftedItems.size).toBe(0);
    });

    test('typed element maps avoid selector fallback and keep source/group key namespaces separate', () => {
        const createClassList = (initial) => {
            const classes = new Set(initial);
            return {
                add: (...names) => names.forEach((name) => classes.add(name)),
                remove: (...names) => names.forEach((name) => classes.delete(name)),
                contains: (name) => classes.has(name)
            };
        };
        const source = {
            dataset: { sourceKey: 'same-key' },
            style: {},
            classList: createClassList(['source-item']),
            getAttribute: (name) => (name === 'data-source-key' ? 'same-key' : null)
        };
        const group = {
            dataset: { groupId: 'same-key' },
            style: {},
            classList: createClassList(['group-container']),
            getAttribute: (name) => (name === 'data-group-id' ? 'same-key' : null)
        };
        const rootElement = {
            contains: (element) => element === source || element === group,
            querySelector: jest.fn(() => {
                throw new Error('typed map hit must not fall back to a selector');
            })
        };
        const session = api.createDragSession();

        const firstResult = api.applyReflow({
            session,
            shifts: {
                sources: new Map([['same-key', 24]]),
                groups: new Map([['same-key', 48]])
            },
            rootElement,
            sourceElements: new Map([['same-key', source]]),
            groupElements: new Map([['same-key', group]])
        });

        expect(api.supportsAppliedShiftDeltas).toBe(true);
        expect(Array.from(firstResult.appliedShiftDeltas.sources)).toEqual([
            ['same-key', 24]
        ]);
        expect(Array.from(firstResult.appliedShiftDeltas.groups)).toEqual([
            ['same-key', 48]
        ]);
        expect(rootElement.querySelector).not.toHaveBeenCalled();
        expect(source.style.transform).toBe('translateY(24px)');
        expect(group.style.transform).toBe('translateY(48px)');
        expect(source.classList.contains('sp-drop-shift')).toBe(true);
        expect(group.classList.contains('sp-drop-shift')).toBe(true);

        const changedResult = api.applyReflow({
            session,
            shifts: {
                sources: new Map(),
                groups: new Map([['same-key', 64]])
            },
            rootElement,
            sourceElements: new Map([['same-key', source]]),
            groupElements: new Map([['same-key', group]])
        });

        expect(Array.from(changedResult.appliedShiftDeltas.sources)).toEqual([
            ['same-key', -24]
        ]);
        expect(Array.from(changedResult.appliedShiftDeltas.groups)).toEqual([
            ['same-key', 16]
        ]);
        expect(source.style.transform).toBe('');
        expect(group.style.transform).toBe('translateY(64px)');

        api.clearReflow({
            session,
            rootElement,
            sourceElements: new Map([['same-key', source]]),
            groupElements: new Map([['same-key', group]])
        });

        expect(rootElement.querySelector).not.toHaveBeenCalled();
        expect(source.style.transform).toBe('');
        expect(group.style.transform).toBe('');
    });

    test('typed reflow animates only scoped rows and keeps offscreen shifts static', () => {
        const createClassList = (initial) => {
            const classes = new Set(initial);
            return {
                add: (...names) => names.forEach((name) => classes.add(name)),
                remove: (...names) => names.forEach((name) => classes.delete(name)),
                contains: (name) => classes.has(name)
            };
        };
        const visible = {
            dataset: { sourceKey: 'visible' },
            style: {},
            classList: createClassList(['source-item']),
            getAttribute: (name) => (name === 'data-source-key' ? 'visible' : null)
        };
        const offscreen = {
            dataset: { sourceKey: 'offscreen' },
            style: {},
            classList: createClassList(['source-item']),
            getAttribute: (name) => (name === 'data-source-key' ? 'offscreen' : null)
        };
        const sourceElements = new Map([
            ['visible', visible],
            ['offscreen', offscreen]
        ]);
        const rootElement = {
            contains: (element) => element === visible || element === offscreen,
            querySelector: jest.fn(() => {
                throw new Error('typed map hit must not fall back to a selector');
            })
        };
        const session = api.createDragSession();
        const shifts = {
            sources: new Map([
                ['visible', 40],
                ['offscreen', 40]
            ]),
            groups: new Map()
        };
        Object.defineProperty(shifts, '_shiftDeltaPlan', {
            value: {
                deltas: {
                    sources: new Map([
                        ['visible', 40],
                        ['offscreen', 40]
                    ]),
                    groups: new Map()
                },
                bases: {
                    sources: session.shiftedSourceItems,
                    groups: session.shiftedGroupItems
                },
                baseSizes: { sources: 0, groups: 0 },
                animatedKeys: {
                    sources: new Set(['visible']),
                    groups: new Set()
                }
            }
        });

        api.applyReflow({
            session,
            shifts,
            rootElement,
            sourceElements,
            groupElements: new Map()
        });

        expect(visible.style.transform).toBe('translateY(40px)');
        expect(visible.classList.contains('sp-drop-shift')).toBe(true);
        expect(visible.classList.contains('sp-drop-shift-static')).toBe(false);
        expect(offscreen.style.transform).toBe('translateY(40px)');
        expect(offscreen.classList.contains('sp-drop-shift')).toBe(false);
        expect(offscreen.classList.contains('sp-drop-shift-static')).toBe(true);

        const nextShifts = {
            sources: new Map([
                ['visible', 40],
                ['offscreen', 40]
            ]),
            groups: new Map()
        };
        Object.defineProperty(nextShifts, '_shiftDeltaPlan', {
            value: {
                deltas: {
                    sources: new Map(),
                    groups: new Map()
                },
                bases: {
                    sources: session.shiftedSourceItems,
                    groups: session.shiftedGroupItems
                },
                baseSizes: { sources: 2, groups: 0 },
                animatedKeys: {
                    sources: new Set(['offscreen']),
                    groups: new Set()
                }
            }
        });

        api.applyReflow({
            session,
            shifts: nextShifts,
            rootElement,
            sourceElements,
            groupElements: new Map()
        });

        expect(visible.classList.contains('sp-drop-shift')).toBe(false);
        expect(visible.classList.contains('sp-drop-shift-static')).toBe(true);
        expect(offscreen.classList.contains('sp-drop-shift')).toBe(true);
        expect(offscreen.classList.contains('sp-drop-shift-static')).toBe(false);

        const clearedShifts = {
            sources: new Map(),
            groups: new Map()
        };
        Object.defineProperty(clearedShifts, '_shiftDeltaPlan', {
            value: {
                deltas: {
                    sources: new Map([
                        ['visible', -40],
                        ['offscreen', -40]
                    ]),
                    groups: new Map()
                },
                bases: {
                    sources: session.shiftedSourceItems,
                    groups: session.shiftedGroupItems
                },
                baseSizes: { sources: 2, groups: 0 },
                animatedKeys: {
                    sources: new Set(),
                    groups: new Set()
                }
            }
        });
        api.applyReflow({
            session,
            shifts: clearedShifts,
            rootElement,
            sourceElements,
            groupElements: new Map()
        });

        expect(visible.style.transform).toBe('');
        expect(visible.classList.contains('sp-drop-shift-static')).toBe(true);
        expect(offscreen.style.transform).toBe('');
        expect(offscreen.classList.contains('sp-drop-shift')).toBe(false);
        expect(session.shiftedSourceItems.size).toBe(0);
        expect(session.staticShiftClassSourceItems).toEqual(new Set(['visible']));

        api.clearReflow({
            session,
            rootElement,
            sourceElements,
            groupElements: new Map()
        });

        expect(visible.style.transform).toBe('');
        expect(offscreen.style.transform).toBe('');
        expect(visible.classList.contains('sp-drop-shift-static')).toBe(false);
        expect(offscreen.classList.contains('sp-drop-shift')).toBe(false);
        expect(session.animatedShiftedSourceItems.size).toBe(0);
        expect(session.usesScopedShiftClasses).toBe(false);
        expect(rootElement.querySelector).not.toHaveBeenCalled();
    });
});

describe('findItemElement source-key escaping (security)', () => {
    let originalCSS;
    beforeEach(() => { originalCSS = globalThis.CSS; });
    afterEach(() => {
        if (originalCSS === undefined) delete globalThis.CSS;
        else globalThis.CSS = originalCSS;
    });

    test('escapes the untrusted source key via CSS.escape, not a quote-only replace', () => {
        // NotebookLM-derived source keys can contain ], backslashes, or leading
        // digits that break a `[data-source-key="..."]` selector. A hand-rolled
        // replace(/"/g) only escapes quotes; CSS.escape covers the full grammar.
        // Sentinel-wrap CSS.escape so we can assert the selector is built from it.
        globalThis.CSS = { escape: jest.fn((s) => `ESC<${s}>`) };
        const api = createContentDragReflow();
        const el = { style: { transform: '' }, classList: { add() {}, remove() {} } };
        const querySelector = jest.fn(() => el);
        // Empty session + non-empty shifts → Phase 2 actually resolves the element.
        api.applyReflow({
            session: { shiftedItems: new Map() },
            shifts: new Map([['a]b', 40]]),
            rootElement: { querySelector }
        });
        expect(globalThis.CSS.escape).toHaveBeenCalledWith('a]b');
        expect(querySelector).toHaveBeenCalledWith('[data-source-key="ESC<a]b>"]');
    });

    test('escapes every untrusted key in the >=8-item batch selector', () => {
        const keys = [
            'plain',
            'quote"]',
            'close]bracket',
            'back\\slash',
            '1leading',
            'comma,selector',
            'pseudo:not(*)',
            'newline\nkey'
        ];
        globalThis.CSS = {
            escape: jest.fn((value) => `SAFE_${keys.indexOf(value)}`)
        };
        const querySelectorAll = jest.fn(() => []);
        const querySelector = jest.fn(() => null);
        const api = createContentDragReflow();

        api.prepareDragSession({
            draggedKeys: keys,
            rootElement: { querySelectorAll, querySelector }
        });

        expect(querySelectorAll.mock.calls[0][0]).toBe(
            keys.map((_key, index) => `[data-source-key="SAFE_${index}"]`).join(', ')
        );
        for (const key of keys) {
            expect(globalThis.CSS.escape).toHaveBeenCalledWith(key);
        }
    });
});
