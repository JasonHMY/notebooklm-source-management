const createContentDragPointer = require('../../src/content/content-drag-pointer.js');

function makeTarget() {
    const listeners = new Map();
    return {
        addEventListener: jest.fn((type, listener) => {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type).add(listener);
        }),
        removeEventListener: jest.fn((type, listener) => listeners.get(type)?.delete(listener)),
        emit(type, values = {}) {
            const event = {
                type,
                preventDefault: jest.fn(),
                stopImmediatePropagation: jest.fn(),
                ...values
            };
            for (const listener of [...(listeners.get(type) || [])]) listener(event);
            return event;
        }
    };
}

function setup() {
    const root = makeTarget();
    const doc = makeTarget();
    const win = makeTarget();
    win.setTimeout = jest.fn((callback) => setTimeout(callback, 0));
    win.clearTimeout = jest.fn(clearTimeout);
    root.getBoundingClientRect = () => ({ left: 0, top: 0, right: 300, bottom: 400 });
    root.contains = (node) => node && node.inRoot === true;
    root.setPointerCapture = jest.fn((pointerId) => { root.captured = pointerId; });
    root.hasPointerCapture = jest.fn((pointerId) => root.captured === pointerId);
    root.releasePointerCapture = jest.fn(() => { root.captured = null; });
    const handle = {
        inRoot: true,
        disabled: false,
        getAttribute: () => null,
        closest: () => handle,
        nodeType: 1
    };
    const other = { nodeType: 1, closest: () => null };
    const callbacks = {
        onStart: jest.fn(() => true),
        onUpdate: jest.fn(),
        onCommit: jest.fn(),
        onCancel: jest.fn(),
        onKeyMove: jest.fn()
    };
    let currentRoot = root;
    let valid = true;
    const helper = createContentDragPointer({
        getRoot: () => currentRoot,
        getDocument: () => doc,
        getWindow: () => win,
        isContextValid: () => valid,
        ...callbacks
    });
    helper.bind(root);
    const pointer = (type, values = {}) => root.emit(type, {
        target: handle,
        pointerId: 7,
        pointerType: 'mouse',
        isPrimary: true,
        button: 0,
        clientX: 50,
        clientY: 50,
        ...values
    });
    return { root, doc, win, handle, other, callbacks, helper, pointer,
        invalidate: () => { valid = false; },
        replaceRoot: () => { currentRoot = makeTarget(); }
    };
}

describe('content drag pointer', () => {
    it('starts only from an enabled primary-button handle after crossing 3px', () => {
        const { pointer, other, handle, callbacks, helper, root } = setup();
        pointer('pointerdown', { target: other });
        pointer('pointermove', { clientY: 60 });
        pointer('pointerdown', { button: 2 });
        pointer('pointerdown', { isPrimary: false });
        handle.disabled = true;
        pointer('pointerdown');
        handle.disabled = false;
        expect(callbacks.onStart).not.toHaveBeenCalled();

        pointer('pointerdown');
        expect(root.setPointerCapture).toHaveBeenCalledWith(7);
        pointer('pointermove', { clientY: 53 });
        expect(callbacks.onStart).not.toHaveBeenCalled();
        pointer('pointermove', { clientY: 54 });
        expect(callbacks.onStart).toHaveBeenCalledTimes(1);
        expect(callbacks.onStart).toHaveBeenCalledWith(expect.objectContaining({
            handle, clientX: 50, clientY: 50, pointerId: 7, pointerType: 'mouse', sessionId: 1
        }));
        expect(callbacks.onUpdate).toHaveBeenCalledWith(expect.objectContaining({ clientY: 54 }));
        expect(helper.isActive()).toBe(true);
        pointer('pointerup', { clientY: 100 });
        expect(callbacks.onCommit).toHaveBeenCalledTimes(1);
        expect(callbacks.onCancel).not.toHaveBeenCalled();
        expect(helper.isActive()).toBe(false);
        helper.dispose();
    });

    it('keeps ordinary clicks and suppresses only the post-drag click', () => {
        const { pointer, root, callbacks, helper } = setup();
        pointer('pointerdown');
        pointer('pointerup');
        expect(root.emit('click').preventDefault).not.toHaveBeenCalled();
        pointer('pointerdown');
        pointer('pointermove', { clientY: 70 });
        pointer('pointerup', { clientY: 70 });
        expect(root.emit('click').preventDefault).toHaveBeenCalledTimes(1);
        expect(root.emit('click').preventDefault).not.toHaveBeenCalled();
        expect(callbacks.onCommit).toHaveBeenCalledTimes(1);
        helper.dispose();
    });

    it.each([
        ['pointercancel', 'pointer-cancel'],
        ['lostpointercapture', 'capture-lost']
    ])('cancels on %s', (eventName, reason) => {
        const { pointer, callbacks, helper } = setup();
        pointer('pointerdown');
        pointer('pointermove', { clientY: 65 });
        pointer(eventName);
        expect(callbacks.onCancel).toHaveBeenCalledWith(reason);
        expect(callbacks.onCommit).not.toHaveBeenCalled();
        expect(helper.isActive()).toBe(false);
        helper.dispose();
    });

    it('cancels on outside release, Escape, window blur, and invalidated context', () => {
        const { pointer, doc, win, callbacks, helper, invalidate } = setup();
        pointer('pointerdown');
        pointer('pointermove', { clientY: 65 });
        pointer('pointerup', { clientY: 450 });
        expect(callbacks.onCancel).toHaveBeenLastCalledWith('outside-root');

        pointer('pointerdown');
        pointer('pointermove', { clientY: 65 });
        doc.emit('keydown', { key: 'Escape' });
        expect(callbacks.onCancel).toHaveBeenLastCalledWith('escape');

        pointer('pointerdown');
        pointer('pointermove', { clientY: 65 });
        win.emit('blur');
        expect(callbacks.onCancel).toHaveBeenLastCalledWith('window-blur');

        pointer('pointerdown');
        pointer('pointermove', { clientY: 65 });
        invalidate();
        pointer('pointermove', { clientY: 80 });
        expect(callbacks.onCancel).toHaveBeenLastCalledWith('context-invalid');
        expect(callbacks.onCommit).not.toHaveBeenCalled();
        helper.dispose();
    });

    it('keeps pointer ownership after row replacement and ignores other pointer ids', () => {
        const { pointer, callbacks, helper, handle } = setup();
        pointer('pointerdown');
        pointer('pointermove', { clientY: 70, target: { nodeType: 1, closest: () => null } });
        pointer('pointermove', { pointerId: 9, clientY: 90 });
        pointer('pointerup', { pointerId: 9 });
        expect(helper.isActive()).toBe(true);
        pointer('pointerup', { clientY: 80 });
        expect(callbacks.onCommit).toHaveBeenCalledWith(expect.objectContaining({ handle, clientY: 80 }));
        helper.dispose();
    });

    it('maps unmodified handle keys to directional moves once', () => {
        const { root, handle, callbacks, helper } = setup();
        const expected = { ArrowUp: 'up', ArrowDown: 'down', Home: 'first', End: 'last' };
        for (const [key, direction] of Object.entries(expected)) {
            const event = root.emit('keydown', { key, target: handle });
            expect(event.preventDefault).toHaveBeenCalledTimes(1);
            expect(callbacks.onKeyMove).toHaveBeenLastCalledWith({ handle, direction });
        }
        root.emit('keydown', { key: 'ArrowUp', target: handle, shiftKey: true });
        expect(callbacks.onKeyMove).toHaveBeenCalledTimes(4);
        helper.dispose();
    });

    it('notifies on dispose of an active drag and unbinds listeners', () => {
        const { pointer, root, callbacks, helper } = setup();
        pointer('pointerdown');
        pointer('pointermove', { clientY: 70 });
        helper.dispose();
        expect(callbacks.onCancel).toHaveBeenCalledWith('dispose');
        pointer('pointerdown');
        expect(callbacks.onStart).toHaveBeenCalledTimes(1);
        expect(root.releasePointerCapture).toHaveBeenCalledTimes(1);
    });
});
