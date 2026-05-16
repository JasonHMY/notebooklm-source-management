(function () {
    'use strict';

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
