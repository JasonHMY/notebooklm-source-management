(function () {
    'use strict';

    const DEFAULT_TRANSITION_MS = 200;

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

        function unfoldDraggedItems({ session, rootElement }) {
            if (!session || !rootElement) return;
            for (const key of session.draggedKeys) {
                const el = findItemElement(rootElement, key);
                if (!el || !el.style) continue;
                el.style.height = '';
                el.style.opacity = '';
                if (el.classList && typeof el.classList.remove === 'function') {
                    el.classList.remove('sp-drag-folded');
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
