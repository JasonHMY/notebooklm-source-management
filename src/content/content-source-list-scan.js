(function () {
    'use strict';

    /**
     * createContentSourceListScan() — 源列表扫描时读取原生 checkbox enabled 状态。
     * 与 content-native-checkbox-sync 不同的是,本模块面向"列表全量重扫"场景,
     * 没有 source.key 桥接,直接以 source 元素 + fallback 默认值收口。
     *
     * @returns {{ getNativeCheckboxState, getNativeSourceCheckboxState }}
     *   `getNativeCheckboxState` 返回 true/false/null;
     *   `getNativeSourceCheckboxState` 在 source 无原生 checkbox 时直接返回 true。
     */
    function createContentSourceListScan() {
        function getAttributeValue(element, attr) {
            if (!element || typeof element.getAttribute !== 'function') return '';
            return String(element.getAttribute(attr) || '').trim();
        }

        function getNativeCheckboxState(checkbox) {
            if (!checkbox) return null;
            if (checkbox.indeterminate === true) return null;
            const ariaChecked = getAttributeValue(checkbox, 'aria-checked').toLowerCase();
            if (ariaChecked === 'mixed') return null;
            if (ariaChecked === 'true') return true;
            if (ariaChecked === 'false') return false;
            if (typeof checkbox.checked === 'boolean') return Boolean(checkbox.checked);
            return null;
        }

        function getNativeSourceCheckboxState(source, fallbackState = true) {
            if (!source?.hasNativeCheckbox) return true;
            const checkboxState = getNativeCheckboxState(source.checkbox);
            if (checkboxState !== null) return checkboxState;
            return Boolean(fallbackState);
        }

        return {
            getNativeCheckboxState,
            getNativeSourceCheckboxState
        };
    }

    globalThis.NSM_CREATE_CONTENT_SOURCE_LIST_SCAN = createContentSourceListScan;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentSourceListScan;
    }
})();
