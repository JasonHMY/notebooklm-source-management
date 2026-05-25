(function () {
    'use strict';

    function createContentNativeCheckboxSync(deps = {}) {
        const findFreshCheckbox = typeof deps.findFreshCheckbox === 'function'
            ? deps.findFreshCheckbox
            : () => null;
        const resolveFreshRowEntry = typeof deps.resolveFreshRowEntry === 'function'
            ? deps.resolveFreshRowEntry
            : null;

        function getNativeControlAttribute(element, attr) {
            if (!element || typeof element.getAttribute !== 'function') return '';
            return String(element.getAttribute(attr) || '').trim();
        }

        function getNativeCheckboxState(checkbox) {
            if (!checkbox) return null;
            if (checkbox.indeterminate === true) return null;
            const ariaChecked = getNativeControlAttribute(checkbox, 'aria-checked').toLowerCase();
            if (ariaChecked === 'mixed') return null;
            if (ariaChecked === 'true') return true;
            if (ariaChecked === 'false') return false;
            if (typeof checkbox.checked === 'boolean') return Boolean(checkbox.checked);
            return null;
        }

        function shouldToggleNativeCheckbox(checkbox, desiredState) {
            const currentState = getNativeCheckboxState(checkbox);
            if (currentState === null) return true;
            return currentState !== Boolean(desiredState);
        }

        function resolveDetachedRowEntry(source) {
            if (!source) return null;
            if (resolveFreshRowEntry) {
                const resolvedEntry = resolveFreshRowEntry(source.key);
                if (resolvedEntry) return resolvedEntry;
            }

            const freshCheckbox = findFreshCheckbox(source.key);
            if (!freshCheckbox) return null;

            return {
                checkbox: freshCheckbox,
                row: typeof freshCheckbox.closest === 'function'
                    ? (freshCheckbox.closest('.source-item') || source.element || null)
                    : (source.element || null)
            };
        }

        return {
            getNativeControlAttribute,
            getNativeCheckboxState,
            shouldToggleNativeCheckbox,
            resolveDetachedRowEntry
        };
    }

    globalThis.NSM_CREATE_CONTENT_NATIVE_CHECKBOX_SYNC = createContentNativeCheckboxSync;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentNativeCheckboxSync;
    }
})();
