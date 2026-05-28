(function () {
    'use strict';

    /**
     * createContentToastStatus() — toast 选项归一化 + save-status 文案映射。
     * 提供 toast variant/duration/actionLabel 校验默认值、save status state → i18n key
     * 映射(saving / saved / failed / stale / recovery_available)、以及一个
     * 跨实现的 `clearElementChildren` helper(兼容 replaceChildren 缺失环境)。
     * 不持有运行状态,纯 stateless helpers。无外部 deps。
     *
     * @returns {{ TOAST_DEFAULT_DURATION_MS, TOAST_ACTION_DURATION_MS, normalizeToastOptions, getToastDuration, getSaveStatusMessageKey, clearElementChildren }}
     */
    function createContentToastStatus() {
        const TOAST_DEFAULT_DURATION_MS = 3000;
        const TOAST_ACTION_DURATION_MS = 5000;

        function normalizeToastOptions(options = {}) {
            const normalizedOptions = options && typeof options === 'object' ? options : {};
            const variant = ['info', 'success', 'error'].includes(normalizedOptions.variant)
                ? normalizedOptions.variant
                : 'info';
            return {
                variant,
                actionLabel: typeof normalizedOptions.actionLabel === 'string' ? normalizedOptions.actionLabel : '',
                onAction: typeof normalizedOptions.onAction === 'function' ? normalizedOptions.onAction : null,
                durationMs: Number.isFinite(normalizedOptions.durationMs) && normalizedOptions.durationMs > 0
                    ? normalizedOptions.durationMs
                    : null
            };
        }

        function getToastDuration(item = {}) {
            return item.durationMs || (item.actionLabel ? TOAST_ACTION_DURATION_MS : TOAST_DEFAULT_DURATION_MS);
        }

        function getSaveStatusMessageKey(statusState) {
            switch (statusState) {
                case 'saving':
                    return 'ui_save_status_saving';
                case 'saved':
                    return 'ui_save_status_saved';
                case 'failed':
                    return 'ui_save_status_failed';
                case 'stale':
                    return 'ui_save_status_stale';
                case 'recovery_available':
                    return 'ui_save_status_recovery';
                default:
                    return '';
            }
        }

        function clearElementChildren(element) {
            if (!element) return;
            if (typeof element.replaceChildren === 'function') {
                element.replaceChildren();
                return;
            }
            while (element.firstChild && typeof element.removeChild === 'function') {
                element.removeChild(element.firstChild);
            }
            if (Array.isArray(element.childNodes)) {
                element.childNodes.length = 0;
            }
            if (Array.isArray(element.children)) {
                element.children.length = 0;
            }
        }

        return {
            TOAST_DEFAULT_DURATION_MS,
            TOAST_ACTION_DURATION_MS,
            normalizeToastOptions,
            getToastDuration,
            getSaveStatusMessageKey,
            clearElementChildren
        };
    }

    globalThis.NSM_CREATE_CONTENT_TOAST_STATUS = createContentToastStatus;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentToastStatus;
    }
})();
