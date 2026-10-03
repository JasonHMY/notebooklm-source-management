(function () {
    'use strict';

    const DRAG_THRESHOLD_PX = 3;

    /** Keep pointer ownership on the list container while rows are replaced during rendering. */
    function createContentDragPointer(deps = {}) {
        const ctx = deps && typeof deps === 'object' ? deps : {};
        const getRoot = typeof ctx.getRoot === 'function' ? ctx.getRoot : () => null;
        const getWindow = typeof ctx.getWindow === 'function'
            ? ctx.getWindow
            : () => (typeof window !== 'undefined' ? window : null);
        const getDocument = typeof ctx.getDocument === 'function'
            ? ctx.getDocument
            : () => (typeof document !== 'undefined' ? document : null);
        const isContextValid = typeof ctx.isContextValid === 'function'
            ? ctx.isContextValid
            : () => true;
        let root = null;
        let session = null;
        let nextSessionId = 0;
        let suppressClick = false;
        let clearClickTimer = null;

        function payload(active, event) {
            return {
                handle: active.handle,
                clientX: event.clientX,
                clientY: event.clientY,
                pointerId: active.pointerId,
                pointerType: active.pointerType,
                sessionId: active.id
            };
        }

        function releaseCapture(active) {
            if (!root || typeof root.hasPointerCapture !== 'function'
                || typeof root.releasePointerCapture !== 'function') return;
            try {
                if (root.hasPointerCapture(active.pointerId)) {
                    root.releasePointerCapture(active.pointerId);
                }
            } catch (_) {
                // The browser may already have released capture on pointerup/cancel.
            }
        }

        function clearSession(reason, shouldNotify = true) {
            if (!session) return;
            const active = session;
            session = null;
            releaseCapture(active);
            if (shouldNotify && active.started && typeof ctx.onCancel === 'function') {
                ctx.onCancel(reason);
            }
        }

        function contextIsValid() {
            if (!session) return false;
            let valid = false;
            try {
                valid = (typeof ctx.getRoot !== 'function' || getRoot() === root) && isContextValid();
            } catch (_) {
                valid = false;
            }
            if (!valid) {
                clearSession('context-invalid');
                return false;
            }
            return true;
        }

        function findHandle(target) {
            const element = target && target.nodeType === 1 ? target : target && target.parentElement;
            const handle = element && typeof element.closest === 'function'
                ? element.closest('button.sp-drag-handle')
                : null;
            if (!handle || !root || !root.contains(handle) || handle.disabled
                || handle.getAttribute('aria-disabled') === 'true') return null;
            return handle;
        }

        function onPointerDown(event) {
            if (session || !event.isPrimary || event.button !== 0) return;
            const handle = findHandle(event.target);
            if (!handle) return;
            try {
                if ((typeof ctx.getRoot === 'function' && getRoot() !== root) || !isContextValid()) return;
            } catch (_) {
                return;
            }
            session = {
                id: ++nextSessionId,
                handle,
                pointerId: event.pointerId,
                pointerType: event.pointerType,
                startX: event.clientX,
                startY: event.clientY,
                started: false
            };
            if (typeof root.setPointerCapture === 'function') {
                try {
                    root.setPointerCapture(event.pointerId);
                } catch (_) {
                    clearSession('capture-failed', false);
                }
            }
        }

        function onPointerMove(event) {
            if (!session || event.pointerId !== session.pointerId || !contextIsValid()) return;
            const active = session;
            if (!active.started) {
                if (!root.contains(active.handle) || active.handle.disabled
                    || active.handle.getAttribute('aria-disabled') === 'true') {
                    clearSession('handle-invalid', false);
                    return;
                }
                const dx = event.clientX - active.startX;
                const dy = event.clientY - active.startY;
                if (Math.hypot(dx, dy) <= DRAG_THRESHOLD_PX) return;
                let started = false;
                try {
                    started = typeof ctx.onStart === 'function'
                        && ctx.onStart(payload(active, {
                            clientX: active.startX,
                            clientY: active.startY
                        })) === true;
                } catch (error) {
                    clearSession('start-error', false);
                    throw error;
                }
                if (!started) {
                    clearSession('start-rejected', false);
                    return;
                }
                active.started = true;
            }
            event.preventDefault();
            if (typeof ctx.onUpdate === 'function') {
                try {
                    ctx.onUpdate(payload(active, event));
                } catch (error) {
                    clearSession('update-error');
                    throw error;
                }
            }
        }

        function pointerInsideRoot(event) {
            if (!root || typeof root.getBoundingClientRect !== 'function') return false;
            const rect = root.getBoundingClientRect();
            return event.clientX >= rect.left && event.clientX <= rect.right
                && event.clientY >= rect.top && event.clientY <= rect.bottom;
        }

        function suppressNextClick() {
            suppressClick = true;
            const win = getWindow();
            if (win && typeof win.setTimeout === 'function') {
                clearClickTimer = win.setTimeout(() => {
                    suppressClick = false;
                    clearClickTimer = null;
                }, 0);
            }
        }

        function onPointerUp(event) {
            if (!session || event.pointerId !== session.pointerId || !contextIsValid()) return;
            const active = session;
            if (!active.started) {
                clearSession('below-threshold', false);
                return;
            }
            event.preventDefault();
            suppressNextClick();
            if (!pointerInsideRoot(event)) {
                clearSession('outside-root');
                return;
            }
            session = null;
            releaseCapture(active);
            if (typeof ctx.onCommit === 'function') ctx.onCommit(payload(active, event));
        }

        function onPointerCancel(event) {
            if (session && event.pointerId === session.pointerId) clearSession('pointer-cancel');
        }

        function onLostPointerCapture(event) {
            if (session && event.pointerId === session.pointerId) clearSession('capture-lost');
        }

        function onBlur() {
            clearSession('window-blur');
        }

        function onKeyDown(event) {
            if (event.key === 'Escape') {
                if (session) {
                    event.preventDefault();
                    clearSession('escape');
                }
                return;
            }
            if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
            const directions = {
                ArrowUp: 'up',
                ArrowDown: 'down',
                Home: 'first',
                End: 'last'
            };
            const direction = directions[event.key];
            if (!direction || session || typeof ctx.onKeyMove !== 'function') return;
            const handle = findHandle(event.target);
            if (!handle || !isContextValid()) return;
            event.preventDefault();
            ctx.onKeyMove({ handle, direction });
        }

        function onDocumentKeyDown(event) {
            if (event.key === 'Escape' && session) onKeyDown(event);
        }

        function onClick(event) {
            if (!suppressClick) return;
            suppressClick = false;
            event.preventDefault();
            event.stopImmediatePropagation();
        }

        function detach() {
            if (!root) return;
            root.removeEventListener('pointerdown', onPointerDown);
            root.removeEventListener('pointermove', onPointerMove);
            root.removeEventListener('pointerup', onPointerUp);
            root.removeEventListener('pointercancel', onPointerCancel);
            root.removeEventListener('lostpointercapture', onLostPointerCapture);
            root.removeEventListener('keydown', onKeyDown);
            root.removeEventListener('click', onClick, true);
            const win = getWindow();
            if (win) win.removeEventListener('blur', onBlur);
            const doc = getDocument();
            if (doc) doc.removeEventListener('keydown', onDocumentKeyDown);
            root = null;
        }

        function bind(nextRoot = getRoot()) {
            if (root === nextRoot) return;
            clearSession('rebind');
            detach();
            if (!nextRoot || typeof nextRoot.addEventListener !== 'function') return;
            root = nextRoot;
            root.addEventListener('pointerdown', onPointerDown);
            root.addEventListener('pointermove', onPointerMove);
            root.addEventListener('pointerup', onPointerUp);
            root.addEventListener('pointercancel', onPointerCancel);
            root.addEventListener('lostpointercapture', onLostPointerCapture);
            root.addEventListener('keydown', onKeyDown);
            root.addEventListener('click', onClick, true);
            const win = getWindow();
            if (win) win.addEventListener('blur', onBlur);
            const doc = getDocument();
            if (doc) doc.addEventListener('keydown', onDocumentKeyDown);
        }

        function dispose() {
            clearSession('dispose');
            detach();
            if (clearClickTimer !== null) {
                const win = getWindow();
                if (win && typeof win.clearTimeout === 'function') win.clearTimeout(clearClickTimer);
            }
            clearClickTimer = null;
            suppressClick = false;
        }

        return {
            bind,
            cancel: (reason = 'cancel') => clearSession(reason),
            dispose,
            isActive: () => Boolean(session && session.started)
        };
    }

    globalThis.NSM_CREATE_CONTENT_DRAG_POINTER = createContentDragPointer;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentDragPointer;
    }
})();
