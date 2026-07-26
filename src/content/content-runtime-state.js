(function () {
    'use strict';

    /**
     * createContentRuntimeState() — 内容脚本运行时的共享 context bag。
     * 提供 `runtimeContext` 单例 + `bindRuntimeProperty(name, getter, setter?)` 来挂载
     * 可枚举/可配置的属性,使得 mutable runtime 字段(state、sourcesByKey、shadowRoot...)
     * 跨 factory 共享而不需要在 deps 里逐个透传。无外部 deps。
     *
     * @returns {{ runtimeContext: Object, bindRuntimeProperty: Function }}
     */
    function createContentRuntimeState() {
        const runtimeContext = {};

        function bindRuntimeProperty(name, getter, setter) {
            if (!name || typeof getter !== 'function') {
                throw new Error('GeminiNotebook-Source-Management: runtime property requires a name and getter.');
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
