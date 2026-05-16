(function () {
    'use strict';

    function createContentNativeLabelScan() {
        function parseNativeLabelSourceCount(value) {
            const text = String(value || '').replace(/\s+/g, ' ').trim();
            if (!text) return null;
            const patterns = [
                /\b(\d{1,5})\s*(?:sources?|items?)\b/i,
                /(?:^|\s)(\d{1,5})\s*(?:个|個)?\s*(?:来源|來源|项目|項目)(?:\s|$)/i
            ];
            for (const pattern of patterns) {
                const match = text.match(pattern);
                if (!match) continue;
                const count = Number.parseInt(match[1], 10);
                if (Number.isFinite(count) && count >= 0) return count;
            }
            return null;
        }

        return {
            parseNativeLabelSourceCount
        };
    }

    globalThis.NSM_CREATE_CONTENT_NATIVE_LABEL_SCAN = createContentNativeLabelScan;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentNativeLabelScan;
    }
})();
