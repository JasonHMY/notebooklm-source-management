(function () {
    'use strict';

    /**
     * createContentMessageRouter(options) — chrome.runtime.onMessage 分发器。
     * 按 request.type 路由到 handlers map 内的 handler;handler 返回 Promise 时自动
     * 桥接 sendResponse 异步通道(MV3 要求 listener return true 保持 channel 开)。
     *
     * @param {Object} options Required: handlers (Object, 形如 { type: (request, sender) => result }).
     *   Optional: onAsyncError(error, request, sender) → response payload,用于统一异步异常落盘。
     * @returns {{ handleMessage, register(runtime), unregister(runtime) }}
     *   register/unregister 操作 runtime.onMessage 的 addListener/removeListener,
     *   失败时(对象缺失)返回 false 不抛错,适合 popup/background SW 通用。
     */
    function createContentMessageRouter(options = {}) {
        const handlers = options.handlers && typeof options.handlers === 'object' ? options.handlers : {};
        const onAsyncError = typeof options.onAsyncError === 'function' ? options.onAsyncError : null;

        function handleMessage(request, sender, sendResponse) {
            if (!request || typeof request.type !== 'string') return undefined;

            const handler = handlers[request.type];
            if (typeof handler !== 'function') return undefined;

            try {
                const result = handler(request, sender);
                if (result && typeof result.then === 'function') {
                    result
                        .then((response) => sendResponse(response))
                        .catch((error) => {
                            if (onAsyncError) {
                                sendResponse(onAsyncError(error, request, sender));
                                return;
                            }
                            sendResponse({ success: false, reason: 'message_handler_failed' });
                        });
                    return true;
                }

                sendResponse(result);
                return undefined;
            } catch (error) {
                if (onAsyncError) {
                    sendResponse(onAsyncError(error, request, sender));
                    return undefined;
                }
                sendResponse({ success: false, reason: 'message_handler_failed' });
                return undefined;
            }
        }

        function register(runtime) {
            const onMessage = runtime?.onMessage;
            if (!onMessage || typeof onMessage.addListener !== 'function') return false;
            onMessage.addListener(handleMessage);
            return true;
        }

        function unregister(runtime) {
            const onMessage = runtime?.onMessage;
            if (!onMessage || typeof onMessage.removeListener !== 'function') return false;
            onMessage.removeListener(handleMessage);
            return true;
        }

        return {
            handleMessage,
            register,
            unregister
        };
    }

    globalThis.NSM_CREATE_CONTENT_MESSAGE_ROUTER = createContentMessageRouter;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentMessageRouter;
    }
})();
