(function () {
    'use strict';

    const DEFAULT_AUTO_SCROLL_EDGE_PX = 60;
    const DEFAULT_AUTO_SCROLL_MAX_SPEED = 14;
    const GHOST_STYLE_PROPERTIES = [
        'display',
        'position',
        'top',
        'right',
        'bottom',
        'left',
        'box-sizing',
        'width',
        'height',
        'min-width',
        'min-height',
        'max-width',
        'max-height',
        'margin',
        'padding',
        'border',
        'border-radius',
        'background',
        'background-color',
        'background-image',
        'box-shadow',
        'opacity',
        'overflow',
        'overflow-x',
        'overflow-y',
        'visibility',
        'flex',
        'flex-basis',
        'flex-direction',
        'flex-grow',
        'flex-shrink',
        'flex-wrap',
        'align-content',
        'align-items',
        'align-self',
        'justify-content',
        'justify-items',
        'justify-self',
        'gap',
        'column-gap',
        'row-gap',
        'grid',
        'grid-area',
        'grid-template-columns',
        'grid-template-rows',
        'font',
        'font-family',
        'font-size',
        'font-style',
        'font-variant',
        'font-weight',
        'font-stretch',
        'font-variation-settings',
        'line-height',
        'letter-spacing',
        'color',
        'text-align',
        'text-decoration',
        'text-overflow',
        'text-transform',
        'white-space',
        'word-break',
        'object-fit',
        'object-position',
        'appearance',
        '-webkit-appearance',
        'overflow-wrap'
    ];

    /**
     * createContentDragMulti(deps) — 多源拖拽 / 自定义 drag ghost / 边缘 auto-scroll 工具集。
     * 解决 HTML5 DnD 单元素 ghost 限制:batch mode 拖多个源时拼出 stacked clone ghost,
     * 拖拽落点附近持续滚动的容器边缘 auto-scroll 用 rAF 驱动。
     *
     * @param {Object} deps Optional: getDocument, requestAnimationFrame, cancelAnimationFrame, el (XSS-safe)。
     *   未提供时回退到 globalThis 对应符号(test harness 可注入 mock)。
     * @returns {{ EDGE_PX, MAX_SPEED, resolveDragSelection, computeAutoScrollVelocity,
     *   createMultiDragGhost, destroyMultiDragGhost,
     *   createAutoScrollController, inlineStylesRecursive, cloneSourceItem }}
     *   resolveDragSelection 判定拖拽是否多选；树状态 mutation 由 Tree Placement Module
     *   负责；createAutoScrollController 在 dragover 边缘触发 rAF loop 滚动容器，destroy 关闭。
     */
    function createContentDragMulti(deps = {}) {
        const ctx = deps && typeof deps === 'object' ? deps : {};

        const getDocument = typeof ctx.getDocument === 'function'
            ? ctx.getDocument
            : () => (typeof document !== 'undefined' ? document : null);

        const requestAnimationFrameFn = typeof ctx.requestAnimationFrame === 'function'
            ? ctx.requestAnimationFrame
            : (typeof globalThis.requestAnimationFrame === 'function'
                ? globalThis.requestAnimationFrame.bind(globalThis)
                : null);

        const cancelAnimationFrameFn = typeof ctx.cancelAnimationFrame === 'function'
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

        function inlineStylesRecursive(cloneNode, originalNode) {
            if (!cloneNode || !originalNode) return;
            if (cloneNode.nodeType === 1 && originalNode.nodeType === 1) {
                if ('checked' in originalNode && 'checked' in cloneNode) {
                    cloneNode.checked = Boolean(originalNode.checked);
                }
                if ('indeterminate' in originalNode && 'indeterminate' in cloneNode) {
                    cloneNode.indeterminate = Boolean(originalNode.indeterminate);
                }
                const win = typeof globalThis.window === 'object' && globalThis.window
                    ? globalThis.window
                    : (typeof window !== 'undefined' ? window : null);
                const computed = win && typeof win.getComputedStyle === 'function'
                    ? win.getComputedStyle(originalNode)
                    : null;
                if (computed && cloneNode.style) {
                    const declarations = [];
                    for (const property of GHOST_STYLE_PROPERTIES) {
                        const value = computed.getPropertyValue(property);
                        if (!value) continue;
                        declarations.push(`${property}: ${value};`);
                    }
                    cloneNode.style.cssText = declarations.join(' ');
                }
            }
            const origChildren = (originalNode && originalNode.children) || [];
            const cloneChildren = (cloneNode && cloneNode.children) || [];
            const len = Math.min(origChildren.length, cloneChildren.length);
            for (let i = 0; i < len; i += 1) {
                inlineStylesRecursive(cloneChildren[i], origChildren[i]);
            }
        }

        function cloneSourceItem(originalEl) {
            if (!originalEl || typeof originalEl.cloneNode !== 'function') return null;
            const clone = originalEl.cloneNode(true);
            inlineStylesRecursive(clone, originalEl);
            return clone;
        }

        function createMultiDragGhost({ count, sourceClones, root }) {
            const doc = getDocument();
            if (!doc || typeof doc.createElement !== 'function') return null;
            if (!root || typeof root.appendChild !== 'function') return null;

            const clones = Array.isArray(sourceClones) ? sourceClones.filter(Boolean) : [];
            const totalCount = typeof count === 'number' && count > 0 ? count : clones.length;

            const ghost = doc.createElement('div');
            ghost.className = 'sp-drag-ghost';
            ghost.setAttribute('aria-hidden', 'true');

            if (totalCount === 1 && clones.length === 1) {
                ghost.className = 'sp-drag-ghost sp-drag-ghost-single';
                // Wrap clone in a layer div so stack-mode CSS transforms aren't shadowed
                // by inline cssText that inlineStylesRecursive writes on the clone itself.
                const layer = doc.createElement('div');
                layer.className = 'sp-drag-ghost-layer';
                layer.appendChild(clones[0]);
                ghost.appendChild(layer);
                root.appendChild(ghost);
                return ghost;
            }

            // Stack mode: up to 3 layer-wrapped clones + badge with totalCount.
            const stack = doc.createElement('div');
            stack.className = 'sp-drag-ghost-stack';
            const stackedClones = clones.slice(0, 3);
            for (const cloneEl of stackedClones) {
                const layer = doc.createElement('div');
                layer.className = 'sp-drag-ghost-layer';
                layer.appendChild(cloneEl);
                stack.appendChild(layer);
            }
            ghost.appendChild(stack);

            const badge = doc.createElement('span');
            badge.className = 'sp-drag-ghost-badge';
            badge.appendChild(doc.createTextNode(String(totalCount)));
            ghost.appendChild(badge);

            root.appendChild(ghost);
            return ghost;
        }

        // CROSS-REF: third path in the drag-ghost cleanup contract. Removes the
        // multi-source ghost element built by createMultiDragGhost. Idempotent
        // and tolerant of detach races. The other two paths are in
        // content-tree-interactions.js: handleDragEnd (primary) and
        // clearDragFeedback (backstop). Modifying any of the three requires
        // checking the others — see CLAUDE.md "Non-obvious gotchas".
        function destroyMultiDragGhost(ghost) {
            if (!ghost) return;
            const parent = ghost.parentNode;
            if (parent && typeof parent.removeChild === 'function') {
                try { parent.removeChild(ghost); } catch (err) { /* ignore detach race */ }
            }
        }

        function createAutoScrollController({ getContainer, onDidScroll }) {
            const resolveContainer = typeof getContainer === 'function' ? getContainer : () => null;
            const notifyDidScroll = typeof onDidScroll === 'function'
                ? onDidScroll
                : null;
            const state = { rafId: null, velocity: 0 };

            function step() {
                state.rafId = null;
                const container = resolveContainer();
                if (!container || typeof container.scrollBy !== 'function') {
                    state.velocity = 0;
                    return;
                }
                const before = typeof container.scrollTop === 'number' ? container.scrollTop : 0;
                const velocity = state.velocity;
                container.scrollBy({ top: velocity, behavior: 'auto' });
                const after = typeof container.scrollTop === 'number' ? container.scrollTop : before;

                if (after === before) {
                    state.velocity = 0;
                    return;
                }
                if (notifyDidScroll) {
                    try {
                        notifyDidScroll({
                            container,
                            before,
                            after,
                            velocity
                        });
                    } catch (_) { /* tree invalidation is best-effort */ }
                }
                if (state.velocity !== 0 && requestAnimationFrameFn) {
                    state.rafId = requestAnimationFrameFn(step);
                }
            }

            function tick(velocity) {
                if (!velocity) {
                    stop();
                    return;
                }
                state.velocity = velocity;
                if (state.rafId !== null) return;
                if (!requestAnimationFrameFn) return;
                state.rafId = requestAnimationFrameFn(step);
            }

            function stop() {
                if (state.rafId !== null && cancelAnimationFrameFn) {
                    cancelAnimationFrameFn(state.rafId);
                }
                state.rafId = null;
                state.velocity = 0;
            }

            return { tick, stop };
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
            destroyMultiDragGhost,
            createAutoScrollController,
            inlineStylesRecursive,
            cloneSourceItem
        };
    }

    globalThis.NSM_CREATE_CONTENT_DRAG_MULTI = createContentDragMulti;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentDragMulti;
    }
})();
