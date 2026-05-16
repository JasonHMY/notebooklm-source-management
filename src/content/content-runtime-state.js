(function () {
    'use strict';

    function createContentRuntimeState() {
        const runtimeContext = {};

        function bindRuntimeProperty(name, getter, setter) {
            if (!name || typeof getter !== 'function') {
                throw new Error('NotebookLM Source Management: runtime property requires a name and getter.');
            }

            const descriptor = {
                enumerable: true,
                configurable: true,
                get: getter
            };
            if (typeof setter === 'function') {
                descriptor.set = setter;
            }
            Object.defineProperty(runtimeContext, name, descriptor);
            return runtimeContext;
        }

        return {
            runtimeContext,
            bindRuntimeProperty
        };
    }

    globalThis.NSM_CREATE_CONTENT_RUNTIME_STATE = createContentRuntimeState;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentRuntimeState;
    }
})();
