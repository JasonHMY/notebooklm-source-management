const createContentModalWhatsNew = require('../../src/content/content-modal-whats-new.js');

function createElement(tag, attrs = {}, children = []) {
    const node = {
        tagName: String(tag).toUpperCase(),
        className: attrs.className || '',
        id: attrs.id || '',
        attrs,
        dataset: attrs.dataset || {},
        children: [],
        listeners: {},
        addEventListener(event, handler) {
            (this.listeners[event] || (this.listeners[event] = [])).push(handler);
        },
        appendChild(child) {
            this.children.push(child);
            if (child && typeof child === 'object') child.parentNode = this;
        },
        classList: { add: jest.fn() },
        focus: jest.fn(),
        querySelector(selector) {
            return collectDescendants(this).find((node) => matchesSelector(node, selector)) || null;
        },
        querySelectorAll(selector) {
            return collectDescendants(this).filter((node) => matchesSelector(node, selector));
        }
    };
    (children || []).forEach((child) => {
        if (!child) return;
        if (typeof child === 'object') child.parentNode = node;
        node.children.push(child);
    });
    return node;
}

function collectDescendants(root) {
    const out = [];
    const queue = root.children.slice();
    while (queue.length > 0) {
        const node = queue.shift();
        if (!node || typeof node !== 'object') continue;
        out.push(node);
        if (Array.isArray(node.children)) queue.push(...node.children);
    }
    return out;
}

function matchesSelector(node, selector) {
    if (!node || typeof node !== 'object') return false;
    if (selector.startsWith('.')) {
        return String(node.className || '').split(/\s+/).includes(selector.slice(1));
    }
    if (selector.startsWith('#')) {
        return node.id === selector.slice(1);
    }
    return node.tagName === selector.toUpperCase();
}

function createDeps(overrides = {}) {
    const shadowRoot = createElement('div');
    return {
        el: jest.fn(createElement),
        getMessage: jest.fn((key) => key),
        getShadowRoot: jest.fn(() => shadowRoot),
        prepareModalOpen: jest.fn(),
        closeManagedModal: jest.fn(() => true),
        bindModalKeyboardNavigation: jest.fn(() => ({ focusInitial: jest.fn(), dispose: jest.fn() })),
        markWhatsNewSeen: jest.fn(() => Promise.resolve(true)),
        createWelcomeFeatureRow: null,
        requestAnimationFrame: undefined,
        ...overrides
    };
}

describe('content modal whats-new', () => {
    it('throws when el/getMessage/getShadowRoot are missing', () => {
        expect(() => createContentModalWhatsNew({})).toThrow(/requires el, getMessage and getShadowRoot/);
    });

    it('closeWhatsNewModal forwards modal and backdrop ids', () => {
        const deps = createDeps();
        const helper = createContentModalWhatsNew(deps);
        helper.closeWhatsNewModal({ restoreFocus: true });
        expect(deps.closeManagedModal).toHaveBeenCalledWith('sp-whats-new-modal', 'sp-whats-new-backdrop', { restoreFocus: true });
    });

    it('renderWhatsNewModal returns false when shadowRoot is missing', () => {
        const deps = createDeps({ getShadowRoot: () => null });
        const helper = createContentModalWhatsNew(deps);
        expect(helper.renderWhatsNewModal()).toBe(false);
        expect(deps.prepareModalOpen).not.toHaveBeenCalled();
    });

    it('renders the modal scaffolding with two feature rows from the fallback featureRow', () => {
        const deps = createDeps();
        const helper = createContentModalWhatsNew(deps);

        expect(helper.renderWhatsNewModal()).toBe(true);
        const shadow = deps.getShadowRoot();
        expect(shadow.querySelector('.sp-whats-new-modal')).toBeTruthy();
        expect(shadow.querySelectorAll('.sp-welcome-feature-row')).toHaveLength(2);
    });

    it('uses the injected createWelcomeFeatureRow when provided', () => {
        const customRow = jest.fn((icon, titleKey, bodyKey) => createElement('section', { className: `custom-${icon}` }));
        const deps = createDeps({ createWelcomeFeatureRow: customRow });
        const helper = createContentModalWhatsNew(deps);

        helper.renderWhatsNewModal();

        expect(customRow).toHaveBeenCalledTimes(2);
        expect(customRow).toHaveBeenNthCalledWith(1, 'drag_pan', 'ui_whats_new_drag_title', 'ui_whats_new_drag_body');
    });

    it('clicking the close button marks whats-new seen and closes the modal', async () => {
        const deps = createDeps();
        const helper = createContentModalWhatsNew(deps);
        helper.renderWhatsNewModal();

        const closeBtn = deps.getShadowRoot().querySelector('.sp-welcome-close-btn');
        closeBtn.listeners.click[0]();

        await Promise.resolve();
        expect(deps.markWhatsNewSeen).toHaveBeenCalledTimes(1);
        expect(deps.closeManagedModal).toHaveBeenCalled();
    });

    it('clicking the primary button also marks seen and closes', async () => {
        const deps = createDeps();
        const helper = createContentModalWhatsNew(deps);
        helper.renderWhatsNewModal();

        const primaryBtn = deps.getShadowRoot().querySelector('.sp-whats-new-primary-btn');
        primaryBtn.listeners.click[0]();

        await Promise.resolve();
        expect(deps.markWhatsNewSeen).toHaveBeenCalledTimes(1);
        expect(deps.closeManagedModal).toHaveBeenCalled();
    });

    it('does NOT mark seen when options.markSeenOnClose is false', async () => {
        const deps = createDeps();
        const helper = createContentModalWhatsNew(deps);
        helper.renderWhatsNewModal({ markSeenOnClose: false });

        deps.getShadowRoot().querySelector('.sp-welcome-close-btn').listeners.click[0]();
        await Promise.resolve();

        expect(deps.markWhatsNewSeen).not.toHaveBeenCalled();
        expect(deps.closeManagedModal).toHaveBeenCalled();
    });

    it('only marks whats-new seen once even when multiple close paths fire', async () => {
        const deps = createDeps();
        const helper = createContentModalWhatsNew(deps);
        helper.renderWhatsNewModal();

        deps.getShadowRoot().querySelector('.sp-welcome-close-btn').listeners.click[0]();
        deps.getShadowRoot().querySelector('.sp-whats-new-primary-btn').listeners.click[0]();
        deps.getShadowRoot().querySelector('.sp-overlay-backdrop').listeners.click[0]();

        await Promise.resolve();
        expect(deps.markWhatsNewSeen).toHaveBeenCalledTimes(1);
    });

    it('uses requestAnimationFrame to defer visibility when provided', () => {
        const rafCallbacks = [];
        const deps = createDeps({
            requestAnimationFrame: (cb) => { rafCallbacks.push(cb); return rafCallbacks.length; }
        });
        const helper = createContentModalWhatsNew(deps);
        helper.renderWhatsNewModal();

        const modal = deps.getShadowRoot().querySelector('.sp-whats-new-modal');
        expect(modal.classList.add).not.toHaveBeenCalled();
        rafCallbacks[0]();
        expect(modal.classList.add).toHaveBeenCalledWith('visible');
    });
});
