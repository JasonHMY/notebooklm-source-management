const createContentMessageRouter = require('../../src/content/content-message-router.js');

describe('content message router', () => {
    it('dispatches known messages to injected handlers', () => {
        const sendResponse = jest.fn();
        const router = createContentMessageRouter({
            handlers: {
                GET_MANAGER_STATUS: () => ({ ready: true })
            }
        });

        const result = router.handleMessage({ type: 'GET_MANAGER_STATUS' }, {}, sendResponse);

        expect(result).toBeUndefined();
        expect(sendResponse).toHaveBeenCalledWith({ ready: true });
    });

    it('keeps the message channel open for async handlers', async () => {
        const sendResponse = jest.fn();
        const router = createContentMessageRouter({
            handlers: {
                SWITCH_SOURCE_VIEW: () => Promise.resolve({ success: true })
            }
        });

        const result = router.handleMessage({ type: 'SWITCH_SOURCE_VIEW' }, {}, sendResponse);
        await Promise.resolve();

        expect(result).toBe(true);
        expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });

    it('uses injected async error handling', async () => {
        const sendResponse = jest.fn();
        const router = createContentMessageRouter({
            handlers: {
                SWITCH_SOURCE_VIEW: () => Promise.reject(new Error('boom'))
            },
            onAsyncError: () => ({ success: false, reason: 'source_view_switch_failed' })
        });

        const result = router.handleMessage({ type: 'SWITCH_SOURCE_VIEW' }, {}, sendResponse);
        await Promise.resolve();
        await Promise.resolve();

        expect(result).toBe(true);
        expect(sendResponse).toHaveBeenCalledWith({ success: false, reason: 'source_view_switch_failed' });
    });

    it('registers and unregisters with runtime onMessage', () => {
        const addListener = jest.fn();
        const removeListener = jest.fn();
        const router = createContentMessageRouter();
        const runtime = { onMessage: { addListener, removeListener } };

        expect(router.register(runtime)).toBe(true);
        expect(router.unregister(runtime)).toBe(true);
        expect(addListener).toHaveBeenCalledWith(router.handleMessage);
        expect(removeListener).toHaveBeenCalledWith(router.handleMessage);
    });
});
