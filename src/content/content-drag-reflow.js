(function () {
    'use strict';

    // Mirrors the CSS var(--sp-motion-base) used by .sp-drag-folded,
    // .sp-drop-shift, .sp-drop-landing, .sp-drop-flying, .sp-drag-unfolding
    // (all sourced from UI_GUIDELINES motion token). Kept here as a publicly
    // queryable constant so callers can align timeouts / staggered work.
    const DEFAULT_TRANSITION_MS = 180;

    function createContentDragReflow(deps = {}) {
        const _ctx = deps && typeof deps === 'object' ? deps : {};

        function createDragSession() {
            return {
                draggedKeys: new Set(),
                itemHeights: new Map(),
                totalDraggedHeight: 0,
                currentIntent: null,
                shiftedItems: new Map()
            };
        }

        function findItemElement(rootElement, key) {
            if (!rootElement || typeof rootElement.querySelector !== 'function') return null;
            const safe = String(key).replace(/"/g, '\\"');
            return rootElement.querySelector(`[data-source-key="${safe}"]`)
                || rootElement.querySelector(`[data-group-id="${safe}"]`);
        }

        function prepareDragSession({ draggedKeys, rootElement }) {
            const session = createDragSession();
            const keys = Array.isArray(draggedKeys) ? draggedKeys : [];
            let total = 0;
            for (const key of keys) {
                if (typeof key !== 'string' || !key) continue;
                session.draggedKeys.add(key);
                const el = findItemElement(rootElement, key);
                const h = el && typeof el.offsetHeight === 'number' ? el.offsetHeight : 0;
                session.itemHeights.set(key, h);
                total += h;
            }
            session.totalDraggedHeight = total;
            return session;
        }

        function foldDraggedItems({ session, rootElement }) {
            if (!session || !rootElement) return;
            for (const key of session.draggedKeys) {
                const el = findItemElement(rootElement, key);
                if (!el || !el.style) continue;
                el.style.height = '0px';
                el.style.opacity = '0';
                if (el.classList && typeof el.classList.add === 'function') {
                    el.classList.add('sp-drag-folded');
                }
            }
        }

        // animated=true smoothly unfolds the dragged item from height 0 back to its cached
        // natural height (200ms cubic-bezier, paired with .sp-drag-unfolding CSS rule).
        // Used by dragend / esc cancel so the dragged row doesn't "snap" back into the list.
        // animated=false (default) does an instant restore — used by drop where render()
        // already rebuilt the DOM so transition would be a no-op anyway.
        function unfoldDraggedItems({ session, rootElement, animated }) {
            if (!session || !rootElement) return;
            const win = (typeof globalThis !== 'undefined' && typeof globalThis.setTimeout === 'function')
                ? globalThis
                : null;
            for (const key of session.draggedKeys) {
                const el = findItemElement(rootElement, key);
                if (!el || !el.style) continue;
                const isFolded = el.classList && typeof el.classList.contains === 'function'
                    && el.classList.contains('sp-drag-folded');
                const cachedHeight = session.itemHeights && typeof session.itemHeights.get === 'function'
                    ? session.itemHeights.get(key)
                    : null;
                if (animated && isFolded && typeof cachedHeight === 'number' && cachedHeight > 0) {
                    // Smooth path: swap fold class → unfolding class, set explicit pixel height +
                    // opacity 1 so transition rules have well-defined from/to values.
                    if (el.classList && typeof el.classList.add === 'function') {
                        el.classList.add('sp-drag-unfolding');
                    }
                    el.classList.remove('sp-drag-folded');
                    el.style.height = `${cachedHeight}px`;
                    el.style.opacity = '1';
                    const cleanup = () => {
                        if (el.classList && typeof el.classList.remove === 'function') {
                            el.classList.remove('sp-drag-unfolding');
                        }
                        if (el.style) {
                            el.style.height = '';
                            el.style.opacity = '';
                        }
                    };
                    if (win) win.setTimeout(cleanup, 240);
                    continue;
                }
                // Instant path: drop scenario, or no cached height to animate to.
                el.style.height = '';
                el.style.opacity = '';
                if (el.classList && typeof el.classList.remove === 'function') {
                    el.classList.remove('sp-drag-folded');
                    el.classList.remove('sp-drag-unfolding');
                }
            }
        }

        function computeReflow({ session, insertIndex, siblingKeys }) {
            const shifts = new Map();
            if (!session || !Array.isArray(siblingKeys)) return shifts;
            if (typeof insertIndex !== 'number' || insertIndex < 0) return shifts;

            const slotHeight = session.totalDraggedHeight;
            if (slotHeight <= 0) return shifts;

            for (let i = insertIndex; i < siblingKeys.length; i += 1) {
                const key = siblingKeys[i];
                if (typeof key !== 'string' || !key) continue;
                if (session.draggedKeys.has(key)) continue;
                shifts.set(key, slotHeight);
            }
            return shifts;
        }

        function applyReflow({ session, shifts, rootElement }) {
            if (!session || !rootElement) return;
            const next = shifts instanceof Map ? shifts : new Map();

            for (const key of session.shiftedItems.keys()) {
                if (!next.has(key)) {
                    const el = findItemElement(rootElement, key);
                    if (el && el.style) el.style.transform = '';
                    if (el && el.classList && typeof el.classList.remove === 'function') {
                        el.classList.remove('sp-drop-shift');
                    }
                    session.shiftedItems.delete(key);
                }
            }

            for (const [key, delta] of next) {
                const prev = session.shiftedItems.get(key);
                if (prev === delta) continue;
                const el = findItemElement(rootElement, key);
                if (!el || !el.style) continue;
                el.style.transform = `translateY(${delta}px)`;
                if (el.classList && typeof el.classList.add === 'function') {
                    el.classList.add('sp-drop-shift');
                }
                session.shiftedItems.set(key, delta);
            }
        }

        function clearReflow({ session, rootElement }) {
            if (!session || !rootElement) return;
            for (const key of session.shiftedItems.keys()) {
                const el = findItemElement(rootElement, key);
                if (el && el.style) el.style.transform = '';
                if (el && el.classList && typeof el.classList.remove === 'function') {
                    el.classList.remove('sp-drop-shift');
                }
            }
            session.shiftedItems.clear();
        }

        // Extract translateY pixel offset from an inline `transform: translateY(Npx)` value.
        // Returns 0 when absent or unparseable. Used by drop-intent detection so an active
        // reflow shift on a sibling does not influence which slot the pointer is mapped to.
        function extractInlineTranslateY(el) {
            if (!el || !el.style) return 0;
            const t = el.style.transform || '';
            if (!t) return 0;
            const m = t.match(/translateY\((-?\d+(?:\.\d+)?)px\)/);
            return m ? parseFloat(m[1]) : 0;
        }

        return {
            TRANSITION_MS: DEFAULT_TRANSITION_MS,
            createDragSession,
            prepareDragSession,
            foldDraggedItems,
            unfoldDraggedItems,
            computeReflow,
            applyReflow,
            clearReflow,
            extractInlineTranslateY
        };
    }

    globalThis.NSM_CREATE_CONTENT_DRAG_REFLOW = createContentDragReflow;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentDragReflow;
    }
})();
