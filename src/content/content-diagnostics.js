(function () {
    'use strict';

    /**
     * createContentDiagnostics() — 内容脚本错误事件 + 诊断信息的标准化层。
     * 把 `window.onerror` / `unhandledrejection` event 规范成 developerLog 可消费的
     * `{ error, sourcePresent, line, column }` 形,并提供 plain-object / native-label-import
     * summary 浅克隆 + diagnostics info pretty-print。无外部 deps。
     *
     * @returns {{ clonePlainObject, cloneNativeLabelImportSummary, getContentErrorLogDetails, getUnhandledRejectionLogDetails, stringifyDiagnostics }}
     */
    function createContentDiagnostics() {
        function clonePlainObject(value) {
            return value && typeof value === 'object' ? Object.assign({}, value) : null;
        }

        function cloneNativeLabelImportSummary(summary) {
            if (!summary || typeof summary !== 'object') return null;
            return Object.assign({}, summary, {
                labels: Array.isArray(summary.labels)
                    ? summary.labels.map((label) => Object.assign({}, label))
                    : []
            });
        }

        function getContentErrorLogDetails(event) {
            const error = event?.error instanceof Error
                ? event.error
                : new Error(event?.message || 'content_error');
            return {
                error,
                sourcePresent: Boolean(event?.filename),
                line: Number(event?.lineno) || 0,
                column: Number(event?.colno) || 0
            };
        }

        function getUnhandledRejectionLogDetails(event) {
            const reason = event?.reason;
            const error = reason instanceof Error
                ? reason
                : new Error(String(reason?.message || reason || 'unhandled_rejection'));
            return { error };
        }

        function stringifyDiagnostics(info) {
            return JSON.stringify(info || {}, null, 2);
        }

        return {
            clonePlainObject,
            cloneNativeLabelImportSummary,
            getContentErrorLogDetails,
            getUnhandledRejectionLogDetails,
            stringifyDiagnostics
        };
    }

    globalThis.NSM_CREATE_CONTENT_DIAGNOSTICS = createContentDiagnostics;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentDiagnostics;
    }
})();
