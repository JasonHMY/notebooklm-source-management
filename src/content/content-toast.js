(function () {
    'use strict';

    /**
     * createContentToast(deps) — Shadow DOM 内 toast 通知队列。
     * 单元素复用模型(`.sp-toast` 永远只存在一个),后续 toast 进队列等当前 hide 完
     * + 120ms 间隔后再显;showUndoableToast 自动给底层 undoStack 注入 "Undo" 按钮。
     *
     * @param {Object} deps Required: normalizeToastOptions, getToastDuration (缺一抛错).
     *   Optional: document, setTimeout, clearTimeout, getMessage, getUndoStack, runUndo, runtime (含 shadowRoot)。
     * @returns {{ ensureToastElement, clearToastTimeout, hideActiveToast, showNextToast,
     *   showToast, showUndoableToast, resetToastState, getToastQueueLength, getActiveToastItem }}
     *   showToast 是入口,showUndoableToast 在 undoStack 有项时附加 undo action;
     *   resetToastState 给 teardown / 单测复位用。
     */
    function createContentToast(deps = {}) {
        const {
            document: documentObj = globalThis.document,
            setTimeout: setTimeoutFn = globalThis.setTimeout,
            clearTimeout: clearTimeoutFn = globalThis.clearTimeout,
            normalizeToastOptions,
            getToastDuration,
            getMessage,
            getUndoStack = () => [],
            runUndo = () => {}
        } = deps;
        const runtime = deps.runtime || deps;

        if (typeof normalizeToastOptions !== 'function' || typeof getToastDuration !== 'function') {
            throw new Error('NotebookLM Source Management: createContentToast requires normalizeToastOptions and getToastDuration.');
        }

        let toastTimeout = null;
        let activeToastItem = null;
        const toastQueue = [];

        function getShadowRoot() {
            return runtime?.shadowRoot || null;
        }

        function ensureToastElement() {
            const shadowRoot = getShadowRoot();
            if (!shadowRoot) return null;
            let toast = shadowRoot.querySelector('.sp-toast');
            if (!toast) {
                toast = documentObj.createElement('div');
                toast.className = 'sp-toast sp-toast-info';
                shadowRoot.appendChild(toast);
            }
            toast.setAttribute('role', 'status');
            toast.setAttribute('aria-live', 'polite');
            return toast;
        }

        function clearToastTimeout() {
            if (toastTimeout) {
                clearTimeoutFn(toastTimeout);
                toastTimeout = null;
            }
        }

        function hideActiveToast(showNext = true) {
            const shadowRoot = getShadowRoot();
            const toast = shadowRoot?.querySelector?.('.sp-toast');
            if (toast) {
                toast.classList.remove('show');
            }
            clearToastTimeout();
            activeToastItem = null;
            if (showNext && toastQueue.length > 0) {
                toastTimeout = setTimeoutFn(() => {
                    toastTimeout = null;
                    showNextToast();
                }, 120);
            }
        }

        function showNextToast() {
            if (activeToastItem || toastQueue.length === 0) return;
            const toast = ensureToastElement();
            if (!toast) return;

            const item = toastQueue.shift();
            activeToastItem = item;
            toast.className = `sp-toast sp-toast-${item.variant}${item.elevated ? ' sp-toast-elevated' : ''}`;
            toast.setAttribute('role', 'status');
            toast.setAttribute('aria-live', 'polite');

            const messageNode = documentObj.createElement('span');
            messageNode.className = 'sp-toast-message';
            messageNode.textContent = item.message;
            const children = [messageNode];

            if (item.actionLabel && item.onAction) {
                const actionButton = documentObj.createElement('button');
                actionButton.type = 'button';
                actionButton.className = 'sp-toast-action';
                actionButton.textContent = item.actionLabel;
                actionButton.addEventListener('click', () => {
                    try {
                        item.onAction();
                    } finally {
                        hideActiveToast(true);
                    }
                });
                children.push(actionButton);
            }

            toast.replaceChildren(...children);
            toast.classList.remove('show');
            void toast.offsetWidth;
            toast.classList.add('show');

            const duration = getToastDuration(item);
            clearToastTimeout();
            toastTimeout = setTimeoutFn(() => hideActiveToast(true), duration);
        }

        function showToast(message, options = {}) {
            const text = String(message || '').trim();
            if (!text) return;
            toastQueue.push(Object.assign({ message: text }, normalizeToastOptions(options)));
            showNextToast();
        }

        function showUndoableToast(message, options = {}) {
            const normalizedOptions = options && typeof options === 'object' ? options : {};
            const undoStack = getUndoStack() || [];
            if (
                undoStack.length === 0 ||
                normalizedOptions.actionLabel ||
                normalizedOptions.onAction
            ) {
                showToast(message, options);
                return;
            }

            showToast(message, Object.assign({}, normalizedOptions, {
                actionLabel: typeof getMessage === 'function' ? getMessage('ui_undo_action') : 'Undo',
                onAction: runUndo
            }));
        }

        function resetToastState() {
            toastQueue.length = 0;
            activeToastItem = null;
            clearToastTimeout();
        }

        function getToastQueueLength() {
            return toastQueue.length;
        }

        function getActiveToastItem() {
            return activeToastItem;
        }

        return {
            ensureToastElement,
            clearToastTimeout,
            hideActiveToast,
            showNextToast,
            showToast,
            showUndoableToast,
            resetToastState,
            getToastQueueLength,
            getActiveToastItem
        };
    }

    globalThis.NSM_CREATE_CONTENT_TOAST = createContentToast;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentToast;
    }
})();
