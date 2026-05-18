const createContentModalFocus = require('../../src/content/content-modal-focus.js');

describe('content modal focus helper', () => {
    function createFocusable(label) {
        return {
            label,
            focus: jest.fn(),
            getAttribute: jest.fn(() => null)
        };
    }

    it('filters focusable elements and focuses the preferred target', () => {
        const enabled = createFocusable('enabled');
        const disabled = createFocusable('disabled');
        disabled.disabled = true;
        const hidden = createFocusable('hidden');
        hidden.getAttribute = jest.fn((attr) => (attr === 'aria-hidden' ? 'true' : null));
        const modal = {
            querySelectorAll: jest.fn(() => [enabled, disabled, hidden]),
            focus: jest.fn()
        };
        const helper = createContentModalFocus();

        expect(helper.getModalFocusableElements(modal)).toEqual([enabled]);
        expect(helper.focusModalInitialElement(modal)).toBe(enabled);
        expect(enabled.focus).toHaveBeenCalled();
    });

    it('traps tab focus and closes on escape', () => {
        const first = createFocusable('first');
        const last = createFocusable('last');
        const preventDefault = jest.fn();
        const closeModal = jest.fn();
        const modal = {
            querySelectorAll: jest.fn(() => [first, last]),
            getRootNode: jest.fn(() => ({ activeElement: last })),
            focus: jest.fn()
        };
        const helper = createContentModalFocus();

        expect(helper.handleModalKeyboardEvent({ key: 'Tab', preventDefault }, modal, closeModal)).toBe(true);
        expect(preventDefault).toHaveBeenCalled();
        expect(first.focus).toHaveBeenCalled();

        expect(helper.handleModalKeyboardEvent({ key: 'Escape', preventDefault }, modal, closeModal)).toBe(true);
        expect(closeModal).toHaveBeenCalled();
    });

    it('binds and disposes keyboard navigation', () => {
        const addEventListener = jest.fn();
        const removeEventListener = jest.fn();
        const setAttribute = jest.fn();
        const modal = {
            addEventListener,
            removeEventListener,
            setAttribute,
            querySelectorAll: jest.fn(() => []),
            focus: jest.fn()
        };
        const helper = createContentModalFocus();
        const binding = helper.bindModalKeyboardNavigation(modal);

        expect(setAttribute).toHaveBeenCalledWith('role', 'dialog');
        expect(addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
        binding.dispose();
        expect(removeEventListener).toHaveBeenCalledWith('keydown', addEventListener.mock.calls[0][1]);
    });

    it('remembers source action menu focus restore targets', () => {
        const restoreButton = createFocusable('restore');
        restoreButton.dataset = { sourceKey: 'a' };
        restoreButton.isConnected = true;
        const activeElement = {
            closest: jest.fn(() => ({ dataset: { sourceKey: 'a' } }))
        };
        const shadowRoot = {
            activeElement,
            querySelectorAll: jest.fn(() => [restoreButton])
        };
        const helper = createContentModalFocus({
            getShadowRoot: () => shadowRoot
        });

        expect(helper.rememberModalFocusRestoreTarget('modal')).toBe(restoreButton);
        expect(helper.restoreModalFocus('modal')).toBe(restoreButton);
        expect(restoreButton.focus).toHaveBeenCalled();
    });
});
