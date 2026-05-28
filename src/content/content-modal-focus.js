(function () {
    'use strict';

    /**
     * createContentModalFocus(deps) — modal focus-trap / 焦点恢复 工具集。
     * 处理 modal 打开时初始 focus、Tab/Shift+Tab 循环、Esc 钩子、关闭后焦点回到触发元素;
     * remember/restore 一对 API 兜底 stale restore 目标(disconnected / display:none / aria-hidden)。
     *
     * @param {Object} deps Optional: getDocument, getShadowRoot (用于在 Shadow DOM 内查找 activeElement)。
     * @returns {{ MODAL_FOCUSABLE_SELECTOR, getModalFocusableElements, getModalActiveElement,
     *   focusModalInitialElement, handleModalKeyboardEvent, bindModalKeyboardNavigation,
     *   getCurrentFocusElement, resolveModalFocusRestoreTarget, rememberModalFocusRestoreTarget,
     *   restoreModalFocus }}
     *   bindModalKeyboardNavigation 是主入口(返回 { focusInitial, unbind });其余是底层 helper。
     */
    function createContentModalFocus(deps = {}) {
        const getDocument = typeof deps.getDocument === 'function'
            ? deps.getDocument
            : () => (typeof document !== 'undefined' ? document : null);
        const getShadowRoot = typeof deps.getShadowRoot === 'function'
            ? deps.getShadowRoot
            : () => null;
        const modalFocusRestoreTargets = new Map();
        const MODAL_FOCUSABLE_SELECTOR = [
            'button:not([disabled])',
            '[href]',
            'input:not([disabled])',
            'select:not([disabled])',
            'textarea:not([disabled])',
            '[tabindex]:not([tabindex="-1"])'
        ].join(', ');

        function getModalFocusableElements(modal) {
            if (!modal || typeof modal.querySelectorAll !== 'function') return [];

            return Array.from(modal.querySelectorAll(MODAL_FOCUSABLE_SELECTOR))
                .filter((element) => {
                    if (!element || typeof element.focus !== 'function') return false;
                    if (element.disabled || element.getAttribute?.('aria-hidden') === 'true') return false;
                    if (String(element.getAttribute?.('tabindex') || '') === '-1') return false;
                    return true;
                });
        }

        function getModalActiveElement(modal) {
            const root = typeof modal?.getRootNode === 'function' ? modal.getRootNode() : null;
            return root?.activeElement || getDocument()?.activeElement || null;
        }

        function focusModalInitialElement(modal, preferredTarget = null) {
            const target = typeof preferredTarget === 'function'
                ? preferredTarget()
                : preferredTarget;
            if (target && typeof target.focus === 'function') {
                target.focus();
                return target;
            }

            const focusableElements = getModalFocusableElements(modal);
            const fallbackTarget = focusableElements[0] || modal;
            if (fallbackTarget && typeof fallbackTarget.focus === 'function') {
                fallbackTarget.focus();
                return fallbackTarget;
            }

            return null;
        }

        function handleModalKeyboardEvent(event, modal, closeModal) {
            if (!event || !modal) return false;

            if (event.key === 'Escape') {
                event.preventDefault?.();
                if (typeof closeModal === 'function') {
                    closeModal();
                }
                return true;
            }

            if (event.key !== 'Tab') return false;

            const focusableElements = getModalFocusableElements(modal);
            if (focusableElements.length === 0) {
                event.preventDefault?.();
                if (typeof modal.focus === 'function') modal.focus();
                return true;
            }

            const firstElement = focusableElements[0];
            const lastElement = focusableElements[focusableElements.length - 1];
            const activeElement = getModalActiveElement(modal);

            if (event.shiftKey && (!activeElement || activeElement === firstElement)) {
                event.preventDefault?.();
                lastElement.focus();
                return true;
            }

            if (!event.shiftKey && activeElement === lastElement) {
                event.preventDefault?.();
                firstElement.focus();
                return true;
            }

            return false;
        }

        function bindModalKeyboardNavigation(modal, options = {}) {
            if (!modal || typeof modal.addEventListener !== 'function') {
                return {
                    focusInitial: () => focusModalInitialElement(modal, options.initialFocusTarget),
                    dispose: () => {}
                };
            }

            if (typeof modal.setAttribute === 'function') {
                modal.setAttribute('role', 'dialog');
                modal.setAttribute('aria-modal', 'true');
                modal.setAttribute('tabindex', '-1');
            }

            const closeModal = typeof options.closeModal === 'function' ? options.closeModal : () => {};
            const handleKeydown = (event) => handleModalKeyboardEvent(event, modal, closeModal);
            modal.addEventListener('keydown', handleKeydown);

            return {
                focusInitial: () => focusModalInitialElement(modal, options.initialFocusTarget),
                dispose: () => {
                    if (typeof modal.removeEventListener === 'function') {
                        modal.removeEventListener('keydown', handleKeydown);
                    }
                }
            };
        }

        function getCurrentFocusElement() {
            const shadowRoot = getShadowRoot();
            if (shadowRoot?.activeElement) return shadowRoot.activeElement;
            return getDocument()?.activeElement || null;
        }

        function resolveModalFocusRestoreTarget(activeElement) {
            const shadowRoot = getShadowRoot();
            if (!activeElement || !shadowRoot) return activeElement || null;

            const menuItem = activeElement.closest?.('.sp-source-actions-menu-item');
            const sourceKey = menuItem?.dataset?.sourceKey;
            if (!sourceKey || typeof shadowRoot.querySelectorAll !== 'function') return activeElement;

            return Array.from(shadowRoot.querySelectorAll('.sp-source-actions-button'))
                .find((button) => button?.dataset?.sourceKey === sourceKey) || activeElement;
        }

        function rememberModalFocusRestoreTarget(modalId) {
            if (!modalId || modalFocusRestoreTargets.has(modalId)) {
                return modalFocusRestoreTargets.get(modalId) || null;
            }

            const activeElement = getCurrentFocusElement();
            const restoreTarget = resolveModalFocusRestoreTarget(activeElement);
            if (restoreTarget && typeof restoreTarget.focus === 'function') {
                modalFocusRestoreTargets.set(modalId, restoreTarget);
            }
            return restoreTarget || null;
        }

        function restoreModalFocus(modalId) {
            const restoreTarget = modalFocusRestoreTargets.get(modalId);
            modalFocusRestoreTargets.delete(modalId);
            if (
                restoreTarget &&
                restoreTarget.isConnected !== false &&
                typeof restoreTarget.focus === 'function'
            ) {
                restoreTarget.focus();
                return restoreTarget;
            }
            return null;
        }

        return {
            MODAL_FOCUSABLE_SELECTOR,
            getModalFocusableElements,
            getModalActiveElement,
            focusModalInitialElement,
            handleModalKeyboardEvent,
            bindModalKeyboardNavigation,
            getCurrentFocusElement,
            resolveModalFocusRestoreTarget,
            rememberModalFocusRestoreTarget,
            restoreModalFocus
        };
    }

    globalThis.NSM_CREATE_CONTENT_MODAL_FOCUS = createContentModalFocus;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentModalFocus;
    }
})();
