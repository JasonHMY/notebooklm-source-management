(function () {
    'use strict';

    const DEFAULT_AUTO_SCROLL_EDGE_PX = 60;
    const DEFAULT_AUTO_SCROLL_MAX_SPEED = 14;

    function createContentDragMulti(deps = {}) {
        const ctx = deps && typeof deps === 'object' ? deps : {};

        const _getDocument = typeof ctx.getDocument === 'function'
            ? ctx.getDocument
            : () => (typeof document !== 'undefined' ? document : null);

        const _requestAnimationFrameFn = typeof ctx.requestAnimationFrame === 'function'
            ? ctx.requestAnimationFrame
            : (typeof globalThis.requestAnimationFrame === 'function'
                ? globalThis.requestAnimationFrame.bind(globalThis)
                : null);

        const _cancelAnimationFrameFn = typeof ctx.cancelAnimationFrame === 'function'
            ? ctx.cancelAnimationFrame
            : (typeof globalThis.cancelAnimationFrame === 'function'
                ? globalThis.cancelAnimationFrame.bind(globalThis)
                : null);

        const _elFactory = typeof ctx.el === 'function'
            ? ctx.el
            : (typeof globalThis.el === 'function' ? globalThis.el : null);

        function resolveDragSelection({ originKey, isBatchMode, pendingBatchKeys, sourceOrder }) {
            if (!originKey || typeof originKey !== 'string') {
                return { keys: [], isMulti: false };
            }
            const order = Array.isArray(sourceOrder) ? sourceOrder : [];
            const set = pendingBatchKeys instanceof Set ? pendingBatchKeys : new Set();

            if (!isBatchMode || set.size === 0 || !set.has(originKey)) {
                return { keys: [originKey], isMulti: false };
            }

            const ordered = order.filter((key) => set.has(key));
            if (ordered.length <= 1) {
                return { keys: [originKey], isMulti: false };
            }
            return { keys: ordered, isMulti: true };
        }

        return {
            EDGE_PX: DEFAULT_AUTO_SCROLL_EDGE_PX,
            MAX_SPEED: DEFAULT_AUTO_SCROLL_MAX_SPEED,
            resolveDragSelection
        };
    }

    globalThis.NSM_CREATE_CONTENT_DRAG_MULTI = createContentDragMulti;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentDragMulti;
    }
})();
