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
});
