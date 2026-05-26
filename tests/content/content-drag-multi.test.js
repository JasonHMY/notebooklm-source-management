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

        it('builds a pill with an icon span and the count text for N=2', () => {
            const { doc, root } = makeDocument();
            const helper = createContentDragMulti({ getDocument: () => doc });
            const ghost = helper.createMultiDragGhost({ count: 2, root });
            expect(ghost).toBeTruthy();
            expect(ghost.className).toContain('sp-drag-ghost');
            const countText = ghost.children
                .flatMap((c) => c.children || [])
                .map((node) => node.text)
                .find((text) => text === '2');
            expect(countText).toBe('2');
            expect(root.appendChild).toHaveBeenCalledWith(ghost);
        });

        it('renders the exact count for arbitrary N', () => {
            const { doc, root } = makeDocument();
            const helper = createContentDragMulti({ getDocument: () => doc });
            const ghost = helper.createMultiDragGhost({ count: 17, root });
            const textNodes = ghost.children.flatMap((c) => c.children || []).map((n) => n.text);
            expect(textNodes).toContain('17');
        });

        it('destroyMultiDragGhost is null-safe and detaches an attached element', () => {
            const { doc, root } = makeDocument();
            const helper = createContentDragMulti({ getDocument: () => doc });
            const ghost = helper.createMultiDragGhost({ count: 3, root });
            expect(() => helper.destroyMultiDragGhost(null)).not.toThrow();
            expect(() => helper.destroyMultiDragGhost(undefined)).not.toThrow();
            helper.destroyMultiDragGhost(ghost);
            expect(root.removeChild).toHaveBeenCalledWith(ghost);
        });

        it('returns null when document is unavailable', () => {
            const helper = createContentDragMulti({ getDocument: () => null });
            const ghost = helper.createMultiDragGhost({ count: 2, root: null });
            expect(ghost).toBe(null);
        });
    });
});
