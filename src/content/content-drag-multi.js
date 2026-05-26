(function () {
    'use strict';

    const DEFAULT_AUTO_SCROLL_EDGE_PX = 60;
    const DEFAULT_AUTO_SCROLL_MAX_SPEED = 14;

    function createContentDragMulti(deps = {}) {
        const ctx = deps && typeof deps === 'object' ? deps : {};

        const getDocument = typeof ctx.getDocument === 'function'
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

        function createMultiDragGhost({ count, root }) {
            const doc = getDocument();
            if (!doc || typeof doc.createElement !== 'function') return null;
            if (!root || typeof root.appendChild !== 'function') return null;

            const ghost = doc.createElement('div');
            ghost.className = 'sp-drag-ghost';
            ghost.setAttribute('aria-hidden', 'true');

            const icon = doc.createElement('span');
            icon.className = 'google-symbols sp-drag-ghost-icon';
            icon.appendChild(doc.createTextNode('drag_indicator'));
            ghost.appendChild(icon);

            const countSpan = doc.createElement('span');
            countSpan.className = 'sp-drag-ghost-count';
            countSpan.appendChild(doc.createTextNode(String(count)));
            ghost.appendChild(countSpan);

            root.appendChild(ghost);
            return ghost;
        }

        function destroyMultiDragGhost(ghost) {
            if (!ghost) return;
            const parent = ghost.parentNode;
            if (parent && typeof parent.removeChild === 'function') {
                try { parent.removeChild(ghost); } catch (err) { /* ignore detach race */ }
            }
        }

        function computeAutoScrollVelocity({ pointerY, containerTop, containerBottom, edgePx, maxSpeed }) {
            if (typeof pointerY !== 'number' || typeof containerTop !== 'number' || typeof containerBottom !== 'number') return 0;
            if (typeof edgePx !== 'number' || edgePx <= 0) return 0;
            if (typeof maxSpeed !== 'number' || maxSpeed <= 0) return 0;
            if (pointerY < containerTop || pointerY > containerBottom) return 0;

            const distFromTop = pointerY - containerTop;
            if (distFromTop < edgePx) {
                const ratio = 1 - (distFromTop / edgePx);
                return -1 * Math.min(maxSpeed, maxSpeed * ratio);
            }

            const distFromBottom = containerBottom - pointerY;
            if (distFromBottom < edgePx) {
                const ratio = 1 - (distFromBottom / edgePx);
                return Math.min(maxSpeed, maxSpeed * ratio);
            }

            return 0;
        }

        return {
            EDGE_PX: DEFAULT_AUTO_SCROLL_EDGE_PX,
            MAX_SPEED: DEFAULT_AUTO_SCROLL_MAX_SPEED,
            resolveDragSelection,
            computeAutoScrollVelocity,
            createMultiDragGhost,
            destroyMultiDragGhost
        };
    }

    globalThis.NSM_CREATE_CONTENT_DRAG_MULTI = createContentDragMulti;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentDragMulti;
    }
})();
