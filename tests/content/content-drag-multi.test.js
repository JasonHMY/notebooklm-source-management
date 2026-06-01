const createContentDragMulti = require('../../src/content/content-drag-multi.js');

describe('content-drag-multi factory', () => {
    describe('resolveDragSelection', () => {
        it('returns single key when batch mode is off', () => {
            const helper = createContentDragMulti();
            const result = helper.resolveDragSelection({
                originKey: 'A',
                isBatchMode: false,
                pendingBatchKeys: new Set(['B', 'C']),
                sourceOrder: ['A', 'B', 'C']
            });
            expect(result).toEqual({ keys: ['A'], isMulti: false });
        });

        it('returns ordered selection when batch mode is on and origin is selected', () => {
            const helper = createContentDragMulti();
            const result = helper.resolveDragSelection({
                originKey: 'A',
                isBatchMode: true,
                pendingBatchKeys: new Set(['C', 'A', 'B']),
                sourceOrder: ['C', 'A', 'B']
            });
            expect(result).toEqual({ keys: ['C', 'A', 'B'], isMulti: true });
        });

        it('falls back to origin-only when batch mode is on but origin is not selected', () => {
            const helper = createContentDragMulti();
            const result = helper.resolveDragSelection({
                originKey: 'X',
                isBatchMode: true,
                pendingBatchKeys: new Set(['A', 'B']),
                sourceOrder: ['A', 'B', 'X']
            });
            expect(result).toEqual({ keys: ['X'], isMulti: false });
        });

        it('falls back to origin-only when batch mode is on but selection is empty', () => {
            const helper = createContentDragMulti();
            const result = helper.resolveDragSelection({
                originKey: 'A',
                isBatchMode: true,
                pendingBatchKeys: new Set(),
                sourceOrder: ['A', 'B']
            });
            expect(result).toEqual({ keys: ['A'], isMulti: false });
        });
    });

    describe('computeAutoScrollVelocity', () => {
        const baseArgs = { containerTop: 100, containerBottom: 500, edgePx: 60, maxSpeed: 14 };

        it('returns 0 when pointer is well inside the container', () => {
            const helper = createContentDragMulti();
            const v = helper.computeAutoScrollVelocity({ ...baseArgs, pointerY: 300 });
            expect(v).toBe(0);
        });

        it('returns negative velocity near the top edge, capped at -maxSpeed', () => {
            const helper = createContentDragMulti();
            const atEdge = helper.computeAutoScrollVelocity({ ...baseArgs, pointerY: 100 });
            const midZone = helper.computeAutoScrollVelocity({ ...baseArgs, pointerY: 130 });
            expect(atEdge).toBeLessThanOrEqual(-14);
            expect(midZone).toBeLessThan(0);
            expect(midZone).toBeGreaterThan(atEdge);
        });

        it('returns positive velocity near the bottom edge, capped at +maxSpeed', () => {
            const helper = createContentDragMulti();
            const atEdge = helper.computeAutoScrollVelocity({ ...baseArgs, pointerY: 500 });
            const midZone = helper.computeAutoScrollVelocity({ ...baseArgs, pointerY: 470 });
            expect(atEdge).toBeGreaterThanOrEqual(14);
            expect(midZone).toBeGreaterThan(0);
            expect(midZone).toBeLessThan(atEdge);
        });

        it('returns 0 when pointer is outside the container', () => {
            const helper = createContentDragMulti();
            expect(helper.computeAutoScrollVelocity({ ...baseArgs, pointerY: 50 })).toBe(0);
            expect(helper.computeAutoScrollVelocity({ ...baseArgs, pointerY: 600 })).toBe(0);
        });

        it('returns 0 when edgePx is 0 or negative', () => {
            const helper = createContentDragMulti();
            expect(helper.computeAutoScrollVelocity({ ...baseArgs, pointerY: 100, edgePx: 0 })).toBe(0);
            expect(helper.computeAutoScrollVelocity({ ...baseArgs, pointerY: 500, edgePx: -10 })).toBe(0);
        });
    });

    describe('createMultiDragGhost / destroyMultiDragGhost', () => {
        function makeDocument() {
            const created = [];
            const doc = {
                createElement: jest.fn((tag) => {
                    const el = {
                        tag,
                        children: [],
                        className: '',
                        style: {},
                        appendChild: jest.fn(function (child) { this.children.push(child); return child; }),
                        setAttribute: jest.fn(),
                        parentNode: null
                    };
                    created.push(el);
                    return el;
                }),
                createTextNode: jest.fn((text) => ({ text })),
                body: null
            };
            const root = {
                appendChild: jest.fn(function (child) { child.parentNode = this; return child; }),
                removeChild: jest.fn(function (child) { child.parentNode = null; return child; })
            };
            doc.body = root;
            return { doc, root, created };
        }

        function makeSourceClone(tag = 'div') {
            return {
                tag,
                nodeType: 1,
                className: '',
                style: {},
                children: [],
                parentNode: null
            };
        }

        it('returns null when document is unavailable', () => {
            const helper = createContentDragMulti({ getDocument: () => null });
            const ghost = helper.createMultiDragGhost({ count: 2, root: null, sourceClones: [] });
            expect(ghost).toBe(null);
        });

        it('returns null when root has no appendChild', () => {
            const { doc } = makeDocument();
            const helper = createContentDragMulti({ getDocument: () => doc });
            const ghost = helper.createMultiDragGhost({ count: 1, root: null, sourceClones: [makeSourceClone()] });
            expect(ghost).toBe(null);
        });

        it('single-clone mode (N=1) wraps the clone with sp-drag-ghost + sp-drag-ghost-single and no badge', () => {
            const { doc, root } = makeDocument();
            const clone = makeSourceClone();
            const helper = createContentDragMulti({ getDocument: () => doc });
            const ghost = helper.createMultiDragGhost({ count: 1, sourceClones: [clone], root });

            expect(ghost).toBeTruthy();
            expect(ghost.className).toContain('sp-drag-ghost');
            expect(ghost.className).toContain('sp-drag-ghost-single');
            // The single clone is wrapped in a layer div so stack/single CSS transforms
            // aren't shadowed by the clone's inline cssText.
            expect(ghost.children).toHaveLength(1);
            const layer = ghost.children[0];
            expect(layer.className).toContain('sp-drag-ghost-layer');
            expect(layer.children).toHaveLength(1);
            expect(layer.children[0]).toBe(clone);
            // No badge for N=1
            const badge = ghost.children.find((c) => c.className && c.className.includes('sp-drag-ghost-badge'));
            expect(badge).toBeUndefined();
            // No count pill anymore
            const countSpan = ghost.children.find((c) => c.className && c.className.includes('sp-drag-ghost-count'));
            expect(countSpan).toBeUndefined();
            expect(root.appendChild).toHaveBeenCalledWith(ghost);
        });

        it('multi-clone mode (N=2) builds stack with 2 layers + badge "2"', () => {
            const { doc, root } = makeDocument();
            const clones = [makeSourceClone(), makeSourceClone()];
            const helper = createContentDragMulti({ getDocument: () => doc });
            const ghost = helper.createMultiDragGhost({ count: 2, sourceClones: clones, root });

            expect(ghost).toBeTruthy();
            expect(ghost.className).toContain('sp-drag-ghost');
            expect(ghost.className).not.toContain('sp-drag-ghost-single');
            const stack = ghost.children.find((c) => c.className && c.className.includes('sp-drag-ghost-stack'));
            expect(stack).toBeTruthy();
            // Each clone is wrapped in a sp-drag-ghost-layer div inside the stack
            expect(stack.children).toHaveLength(2);
            stack.children.forEach((layer, i) => {
                expect(layer.className).toContain('sp-drag-ghost-layer');
                expect(layer.children[0]).toBe(clones[i]);
            });
            const badge = ghost.children.find((c) => c.className && c.className.includes('sp-drag-ghost-badge'));
            expect(badge).toBeTruthy();
            expect(badge.children[0].text).toBe('2');
        });

        it('multi-clone mode (N=3) builds stack with 3 layers + badge "3"', () => {
            const { doc, root } = makeDocument();
            const clones = [makeSourceClone(), makeSourceClone(), makeSourceClone()];
            const helper = createContentDragMulti({ getDocument: () => doc });
            const ghost = helper.createMultiDragGhost({ count: 3, sourceClones: clones, root });

            const stack = ghost.children.find((c) => c.className && c.className.includes('sp-drag-ghost-stack'));
            expect(stack.children).toHaveLength(3);
            stack.children.forEach((layer) => {
                expect(layer.className).toContain('sp-drag-ghost-layer');
            });
            const badge = ghost.children.find((c) => c.className && c.className.includes('sp-drag-ghost-badge'));
            expect(badge.children[0].text).toBe('3');
        });

        it('multi-clone mode (N=5 with sourceClones.length=3) caps stack at 3 + badge "5"', () => {
            const { doc, root } = makeDocument();
            const clones = [makeSourceClone(), makeSourceClone(), makeSourceClone()];
            const helper = createContentDragMulti({ getDocument: () => doc });
            const ghost = helper.createMultiDragGhost({ count: 5, sourceClones: clones, root });

            const stack = ghost.children.find((c) => c.className && c.className.includes('sp-drag-ghost-stack'));
            expect(stack.children).toHaveLength(3);
            stack.children.forEach((layer) => {
                expect(layer.className).toContain('sp-drag-ghost-layer');
            });
            const badge = ghost.children.find((c) => c.className && c.className.includes('sp-drag-ghost-badge'));
            expect(badge.children[0].text).toBe('5');
        });

        it('destroyMultiDragGhost is null-safe and detaches an attached element', () => {
            const { doc, root } = makeDocument();
            const helper = createContentDragMulti({ getDocument: () => doc });
            const ghost = helper.createMultiDragGhost({ count: 1, sourceClones: [makeSourceClone()], root });
            expect(() => helper.destroyMultiDragGhost(null)).not.toThrow();
            expect(() => helper.destroyMultiDragGhost(undefined)).not.toThrow();
            helper.destroyMultiDragGhost(ghost);
            expect(root.removeChild).toHaveBeenCalledWith(ghost);
        });
    });

    describe('inlineStylesRecursive', () => {
        function makeStyledNode({ nodeType = 1, children = [] } = {}) {
            return {
                nodeType,
                style: { cssText: '' },
                children
            };
        }

        function makeComputed(props = {}) {
            const keys = Object.keys(props);
            const computed = {
                length: keys.length,
                getPropertyValue: jest.fn((name) => (Object.prototype.hasOwnProperty.call(props, name) ? props[name] : ''))
            };
            keys.forEach((key, idx) => { computed[idx] = key; });
            return computed;
        }

        it('writes inline cssText from getComputedStyle on a single element', () => {
            const helper = createContentDragMulti();
            const computed = makeComputed({ color: 'rgb(0, 0, 0)', 'font-size': '13px' });
            const fakeWindow = { getComputedStyle: jest.fn(() => computed) };
            const original = { nodeType: 1, children: [] };
            const clone = makeStyledNode();
            const previousWindow = globalThis.window;
            globalThis.window = fakeWindow;
            try {
                helper.inlineStylesRecursive(clone, original);
            } finally {
                globalThis.window = previousWindow;
            }

            expect(fakeWindow.getComputedStyle).toHaveBeenCalledWith(original);
            expect(clone.style.cssText).toContain('color: rgb(0, 0, 0);');
            expect(clone.style.cssText).toContain('font-size: 13px;');
        });

        it('recurses into children that exist on both clone and original', () => {
            const helper = createContentDragMulti();
            const computed = makeComputed({ color: 'red' });
            const fakeWindow = { getComputedStyle: jest.fn(() => computed) };
            const childOriginal = { nodeType: 1, children: [] };
            const childClone = makeStyledNode();
            const original = { nodeType: 1, children: [childOriginal] };
            const clone = makeStyledNode({ children: [childClone] });

            const previousWindow = globalThis.window;
            globalThis.window = fakeWindow;
            try {
                helper.inlineStylesRecursive(clone, original);
            } finally {
                globalThis.window = previousWindow;
            }

            expect(fakeWindow.getComputedStyle).toHaveBeenCalledTimes(2);
            expect(clone.style.cssText).toContain('color: red;');
            expect(childClone.style.cssText).toContain('color: red;');
        });

        it('is null-safe (no throw on null / non-element nodes)', () => {
            const helper = createContentDragMulti();
            expect(() => helper.inlineStylesRecursive(null, null)).not.toThrow();
            expect(() => helper.inlineStylesRecursive(null, { nodeType: 1, children: [] })).not.toThrow();
            // text node (nodeType 3) — should not call getComputedStyle, no throw
            const previousWindow = globalThis.window;
            const fakeWindow = { getComputedStyle: jest.fn() };
            globalThis.window = fakeWindow;
            try {
                helper.inlineStylesRecursive({ nodeType: 3, style: {}, children: [] }, { nodeType: 3, children: [] });
                expect(fakeWindow.getComputedStyle).not.toHaveBeenCalled();
            } finally {
                globalThis.window = previousWindow;
            }
        });
    });

    describe('cloneSourceItem', () => {
        it('returns null for null input', () => {
            const helper = createContentDragMulti();
            expect(helper.cloneSourceItem(null)).toBe(null);
            expect(helper.cloneSourceItem(undefined)).toBe(null);
        });

        it('returns null when input lacks cloneNode', () => {
            const helper = createContentDragMulti();
            expect(helper.cloneSourceItem({})).toBe(null);
        });

        it('calls cloneNode(true) and applies inline styles recursively', () => {
            const helper = createContentDragMulti();
            const computed = {
                length: 1,
                0: 'color',
                getPropertyValue: jest.fn(() => 'blue')
            };
            const fakeWindow = { getComputedStyle: jest.fn(() => computed) };
            const cloneNode = {
                nodeType: 1,
                style: { cssText: '' },
                children: []
            };
            const original = {
                nodeType: 1,
                children: [],
                cloneNode: jest.fn((deep) => {
                    expect(deep).toBe(true);
                    return cloneNode;
                })
            };

            const previousWindow = globalThis.window;
            globalThis.window = fakeWindow;
            let result;
            try {
                result = helper.cloneSourceItem(original);
            } finally {
                globalThis.window = previousWindow;
            }

            expect(original.cloneNode).toHaveBeenCalledWith(true);
            expect(result).toBe(cloneNode);
            expect(cloneNode.style.cssText).toContain('color: blue;');
        });
    });

    describe('applyMultiSourceDrop', () => {
        function makeState() {
            return {
                ungrouped: ['A', 'B', 'C', 'D'],
                groups: [
                    {
                        id: 'g1',
                        children: [{ type: 'source', key: 'E' }, { type: 'source', key: 'F' }]
                    }
                ]
            };
        }

        function makeHelpers(state) {
            const groupsById = new Map(state.groups.map((g) => [g.id, g]));
            return {
                removeSourceFromParent: jest.fn((key) => {
                    const idx = state.ungrouped.indexOf(key);
                    if (idx !== -1) {
                        state.ungrouped.splice(idx, 1);
                        return { list: state.ungrouped, index: idx, fromGroupId: null };
                    }
                    for (const group of state.groups) {
                        const cidx = group.children.findIndex((c) => c.type === 'source' && c.key === key);
                        if (cidx !== -1) {
                            group.children.splice(cidx, 1);
                            return { list: group.children, index: cidx, fromGroupId: group.id };
                        }
                    }
                    return null;
                }),
                sourceExists: jest.fn((key) => {
                    if (state.ungrouped.includes(key)) return true;
                    for (const group of state.groups) {
                        if (group.children.some((c) => c.type === 'source' && c.key === key)) return true;
                    }
                    return false;
                }),
                getGroupById: jest.fn((id) => groupsById.get(id) || null)
            };
        }

        it('moves three sources into a group at the TOP, preserving relative order', () => {
            const state = makeState();
            const helpers = makeHelpers(state);
            const helper = createContentDragMulti();
            const result = helper.applyMultiSourceDrop({
                keys: ['A', 'C', 'D'],
                intent: { kind: 'into-group', targetGroupId: 'g1' },
                state,
                helpers
            });
            expect(result.moved).toBe(3);
            expect(state.ungrouped).toEqual(['B']);
            // Dragged batch lands at the TOP (index 0..N) preserving A→C→D order;
            // existing children E, F follow. Matches single-source header-drop
            // semantics where the dropped source appears at the top of the folder.
            expect(state.groups[0].children.map((c) => c.key)).toEqual(['A', 'C', 'D', 'E', 'F']);
        });

        it('skips keys that no longer exist in state', () => {
            const state = makeState();
            const helpers = makeHelpers(state);
            const helper = createContentDragMulti();
            const result = helper.applyMultiSourceDrop({
                keys: ['A', 'GHOST', 'C'],
                intent: { kind: 'into-group', targetGroupId: 'g1' },
                state,
                helpers
            });
            expect(result.moved).toBe(2);
            expect(result.skipped).toBe(1);
        });

        it('inserts before a source intent, advancing past contiguous members of the dragged set', () => {
            const state = {
                ungrouped: ['A', 'B', 'C', 'D'],
                groups: []
            };
            const helpers = makeHelpers(state);
            const helper = createContentDragMulti();
            const result = helper.applyMultiSourceDrop({
                keys: ['B', 'C'],
                intent: { kind: 'before-source', targetList: state.ungrouped, insertIndex: 1 },
                state,
                helpers
            });
            expect(result.moved).toBe(2);
            expect(state.ungrouped).toEqual(['A', 'B', 'C', 'D']);
        });

        it('re-resolves the live target list after reassigning removeSourceFromParent (stale-ref regression)', () => {
            // Production removeSourceFromTree does `state.ungrouped = state.ungrouped.filter(...)`
            // — REASSIGNS the array reference. If applyMultiSourceDrop holds the original
            // intent.targetList reference across the removes, the subsequent splice would
            // mutate an orphan array and state.ungrouped would lose the dragged keys after
            // render(). This test pins the post-remove live-list fetch so the regression
            // (smoke test "moves three batch-selected sources into a folder via drag-and-drop"
            // reaching the before-source path) cannot resurface.
            const state = { ungrouped: ['A', 'B', 'C', 'D'], groups: [] };
            const originalUngrouped = state.ungrouped;
            const helpers = {
                removeSourceFromParent: jest.fn((key) => {
                    state.ungrouped = state.ungrouped.filter((k) => k !== key);
                }),
                sourceExists: jest.fn((key) => state.ungrouped.includes(key)),
                getGroupById: jest.fn(() => null)
            };
            const helper = createContentDragMulti();
            const result = helper.applyMultiSourceDrop({
                keys: ['A', 'B', 'C'],
                intent: { kind: 'before-source', targetList: state.ungrouped, insertIndex: 0, targetGroup: null },
                state,
                helpers
            });
            expect(result.moved).toBe(3);
            expect(state.ungrouped).toEqual(['A', 'B', 'C', 'D']);
            // Confirm the live state.ungrouped is the post-filter reassigned array (not the
            // original one captured in intent.targetList), and that splices went into IT.
            expect(state.ungrouped).not.toBe(originalUngrouped);
        });

        it('returns moved=0 when the target list is entirely the dragged set', () => {
            const state = { ungrouped: ['A', 'B'], groups: [] };
            const helpers = makeHelpers(state);
            const helper = createContentDragMulti();
            const result = helper.applyMultiSourceDrop({
                keys: ['A', 'B'],
                intent: { kind: 'before-source', targetList: state.ungrouped, insertIndex: 0 },
                state,
                helpers
            });
            expect(result.moved).toBe(0);
            expect(state.ungrouped).toEqual(['A', 'B']);
        });

        it('does not call saveState or render', () => {
            const state = makeState();
            const helpers = makeHelpers(state);
            const helper = createContentDragMulti();
            const callTracker = { saveState: jest.fn(), render: jest.fn() };
            helper.applyMultiSourceDrop({
                keys: ['A'],
                intent: { kind: 'into-group', targetGroupId: 'g1' },
                state,
                helpers
            });
            expect(callTracker.saveState).not.toHaveBeenCalled();
            expect(callTracker.render).not.toHaveBeenCalled();
        });

        it('splices multiple {type:"source"} entries into state.root for a root reorder drop', () => {
            const state = {
                root: [{ type: 'group', id: 'g1' }, { type: 'source', key: 'X' }],
                ungrouped: ['A', 'B', 'C']
            };
            const helpers = {
                removeSourceFromParent: jest.fn((key) => {
                    state.ungrouped = state.ungrouped.filter((k) => k !== key);
                }),
                sourceExists: jest.fn((key) => state.ungrouped.includes(key)
                    || state.root.some((e) => e.type === 'source' && e.key === key)),
                getGroupById: jest.fn(() => null)
            };
            const helper = createContentDragMulti();
            const result = helper.applyMultiSourceDrop({
                keys: ['A', 'B'],
                intent: {
                    kind: 'after-group',
                    targetList: state.root,
                    insertIndex: 1,
                    targetGroup: null,
                    isRootList: true
                },
                state,
                helpers
            });
            expect(result.moved).toBe(2);
            // A, B leave the bin and land between the group and source X as OBJECT entries.
            expect(state.ungrouped).toEqual(['C']);
            expect(state.root).toEqual([
                { type: 'group', id: 'g1' },
                { type: 'source', key: 'A' },
                { type: 'source', key: 'B' },
                { type: 'source', key: 'X' }
            ]);
        });

        it('uses object entries when dropping into an empty state.root', () => {
            const state = { root: [], ungrouped: ['A', 'B'] };
            const helpers = {
                removeSourceFromParent: jest.fn((key) => {
                    state.ungrouped = state.ungrouped.filter((k) => k !== key);
                }),
                sourceExists: jest.fn((key) => state.ungrouped.includes(key)),
                getGroupById: jest.fn(() => null)
            };
            const helper = createContentDragMulti();
            const result = helper.applyMultiSourceDrop({
                keys: ['A'],
                intent: { kind: 'before-source', targetList: state.root, insertIndex: 0, targetGroup: null, isRootList: true },
                state,
                helpers
            });
            expect(result.moved).toBe(1);
            expect(state.root).toEqual([{ type: 'source', key: 'A' }]);
            expect(state.ungrouped).toEqual(['B']);
        });

        it('re-resolves the reassigned state.root after removeSourceFromParent (root stale-ref)', () => {
            const state = { root: [{ type: 'source', key: 'Z' }], ungrouped: ['A'] };
            const originalRoot = state.root;
            const helpers = {
                removeSourceFromParent: jest.fn((key) => {
                    state.ungrouped = state.ungrouped.filter((k) => k !== key);
                    state.root = state.root.filter((e) => !(e.type === 'source' && e.key === key));
                }),
                sourceExists: jest.fn((key) => state.ungrouped.includes(key)
                    || state.root.some((e) => e.type === 'source' && e.key === key)),
                getGroupById: jest.fn(() => null)
            };
            const helper = createContentDragMulti();
            const result = helper.applyMultiSourceDrop({
                keys: ['A'],
                intent: { kind: 'after-source', targetList: state.root, insertIndex: 1, targetGroup: null, isRootList: true },
                state,
                helpers
            });
            expect(result.moved).toBe(1);
            expect(state.root).toEqual([{ type: 'source', key: 'Z' }, { type: 'source', key: 'A' }]);
            // splice went into the reassigned array, not the captured orphan.
            expect(state.root).not.toBe(originalRoot);
        });
    });

    describe('createAutoScrollController', () => {
        function makeContainer({ scrollTop = 0, scrollHeight = 1000, clientHeight = 400 } = {}) {
            const state = { scrollTop, scrollHeight, clientHeight };
            return {
                get scrollTop() { return state.scrollTop; },
                set scrollTop(v) { state.scrollTop = v; },
                get scrollHeight() { return state.scrollHeight; },
                get clientHeight() { return state.clientHeight; },
                scrollBy: jest.fn(function ({ top }) { state.scrollTop = Math.max(0, Math.min(state.scrollHeight - state.clientHeight, state.scrollTop + top)); })
            };
        }

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
                }),
                flush: () => {
                    const ids = Array.from(callbacks.keys());
                    for (const id of ids) {
                        const cb = callbacks.get(id);
                        callbacks.delete(id);
                        if (cb) cb();
                    }
                },
                pending: () => callbacks.size
            };
        }

        it('starts the RAF loop on first non-zero tick', () => {
            const container = makeContainer();
            const raf = makeRaf();
            const helper = createContentDragMulti({ requestAnimationFrame: raf.requestAnimationFrame, cancelAnimationFrame: raf.cancelAnimationFrame });
            const controller = helper.createAutoScrollController({ getContainer: () => container });

            controller.tick(10);
            expect(raf.requestAnimationFrame).toHaveBeenCalledTimes(1);
            raf.flush();
            expect(container.scrollBy).toHaveBeenCalledWith({ top: 10, behavior: 'auto' });
        });

        it('does not stack multiple loops when tick is called repeatedly', () => {
            const container = makeContainer();
            const raf = makeRaf();
            const helper = createContentDragMulti({ requestAnimationFrame: raf.requestAnimationFrame, cancelAnimationFrame: raf.cancelAnimationFrame });
            const controller = helper.createAutoScrollController({ getContainer: () => container });

            controller.tick(5);
            controller.tick(8);
            controller.tick(12);
            expect(raf.requestAnimationFrame).toHaveBeenCalledTimes(1);
        });

        it('stops when tick is called with 0', () => {
            const container = makeContainer();
            const raf = makeRaf();
            const helper = createContentDragMulti({ requestAnimationFrame: raf.requestAnimationFrame, cancelAnimationFrame: raf.cancelAnimationFrame });
            const controller = helper.createAutoScrollController({ getContainer: () => container });

            controller.tick(8);
            controller.tick(0);
            expect(raf.cancelAnimationFrame).toHaveBeenCalled();
            raf.flush();
            expect(container.scrollBy).not.toHaveBeenCalled();
        });

        it('stop() is idempotent', () => {
            const raf = makeRaf();
            const helper = createContentDragMulti({ requestAnimationFrame: raf.requestAnimationFrame, cancelAnimationFrame: raf.cancelAnimationFrame });
            const controller = helper.createAutoScrollController({ getContainer: () => makeContainer() });
            expect(() => { controller.stop(); controller.stop(); }).not.toThrow();
        });

        it('stops cleanly when getContainer returns null mid-loop', () => {
            const raf = makeRaf();
            const helper = createContentDragMulti({ requestAnimationFrame: raf.requestAnimationFrame, cancelAnimationFrame: raf.cancelAnimationFrame });
            let container = makeContainer();
            const controller = helper.createAutoScrollController({ getContainer: () => container });

            controller.tick(10);
            container = null;
            expect(() => raf.flush()).not.toThrow();
        });

        it('stops at the bottom scroll boundary', () => {
            const container = makeContainer({ scrollTop: 600, scrollHeight: 1000, clientHeight: 400 });
            const raf = makeRaf();
            const helper = createContentDragMulti({ requestAnimationFrame: raf.requestAnimationFrame, cancelAnimationFrame: raf.cancelAnimationFrame });
            const controller = helper.createAutoScrollController({ getContainer: () => container });

            controller.tick(14);
            raf.flush();
            expect(container.scrollTop).toBe(600);
            expect(raf.pending()).toBe(0);
        });
    });
});
