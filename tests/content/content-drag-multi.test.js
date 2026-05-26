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
});
