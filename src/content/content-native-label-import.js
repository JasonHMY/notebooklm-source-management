(function () {
    'use strict';

    /**
     * createContentNativeLabelImport(deps) — NotebookLM 原生标签 import preview 比对纯函数。
     * 判断扫描出的 preview 是否包含期望 titles、定位 source-count 不齐的 summaries。
     *
     * @param {Object} deps Optional: getComparableNativeImportLabelTitle(value) — 来自
     *   content-native-label-import-controller;默认 trim+lowercase。
     * @returns {{ previewContainsTitles, getIncompleteSummaries }}
     *   `previewContainsTitles` 返回 boolean;`getIncompleteSummaries` 返回带 reason
     *   ('missing_label' / 'source_count_mismatch') 的 summary 列表。
     */
    function createContentNativeLabelImport(deps = {}) {
        const getComparableNativeImportLabelTitle = typeof deps.getComparableNativeImportLabelTitle === 'function'
            ? deps.getComparableNativeImportLabelTitle
            : (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();

        function previewContainsTitles(preview, expectedTitles = []) {
            const normalizedExpectedTitles = (Array.isArray(expectedTitles) ? expectedTitles : [])
                .map((title) => getComparableNativeImportLabelTitle(title))
                .filter(Boolean);
            if (normalizedExpectedTitles.length === 0) return Boolean(preview?.ok);
            const availableTitles = new Set((Array.isArray(preview?.labels) ? preview.labels : [])
                .map((label) => getComparableNativeImportLabelTitle(label?.title || ''))
                .filter(Boolean));
            return normalizedExpectedTitles.every((title) => availableTitles.has(title));
        }

        function getIncompleteSummaries(preview, expectedSummaries = []) {
            const previewByTitle = new Map();
            (Array.isArray(preview?.labels) ? preview.labels : []).forEach((label) => {
                const comparableTitle = getComparableNativeImportLabelTitle(label?.title || '');
                if (!comparableTitle) return;
                previewByTitle.set(comparableTitle, label);
            });

            return (Array.isArray(expectedSummaries) ? expectedSummaries : [])
                .map((summary) => {
                    const comparableTitle = getComparableNativeImportLabelTitle(summary?.title || summary?.comparableTitle || '');
                    if (!comparableTitle) return null;
                    const previewLabel = previewByTitle.get(comparableTitle);
                    const expectedSourceCount = Number.isFinite(summary?.expectedSourceCount)
                        ? Math.max(0, Number(summary.expectedSourceCount))
                        : null;
                    if (!previewLabel) {
                        return Object.assign({}, summary, { reason: 'missing_label' });
                    }
                    if (expectedSourceCount !== null && Number(previewLabel.sourceCount) < expectedSourceCount) {
                        return Object.assign({}, summary, { reason: 'source_count_mismatch' });
                    }
                    return null;
                })
                .filter(Boolean);
        }

        return {
            previewContainsTitles,
            getIncompleteSummaries
        };
    }

    globalThis.NSM_CREATE_CONTENT_NATIVE_LABEL_IMPORT = createContentNativeLabelImport;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentNativeLabelImport;
    }
})();
