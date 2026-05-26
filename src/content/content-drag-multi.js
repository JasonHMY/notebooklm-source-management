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

        return {
            EDGE_PX: DEFAULT_AUTO_SCROLL_EDGE_PX,
            MAX_SPEED: DEFAULT_AUTO_SCROLL_MAX_SPEED
        };
    }

    globalThis.NSM_CREATE_CONTENT_DRAG_MULTI = createContentDragMulti;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentDragMulti;
    }
})();
