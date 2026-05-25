const createContentModalWelcome = require('../../src/content/content-modal-welcome.js');

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
        markWelcomeOnboardingSeen: jest.fn(() => Promise.resolve(true)),
        openWebStoreFeedback: jest.fn(),
        requestAnimationFrame: undefined,
        ...overrides
    };
}

describe('content modal welcome', () => {
    it('throws when el/getMessage/getShadowRoot are missing', () => {
        expect(() => createContentModalWelcome({})).toThrow(/requires el, getMessage and getShadowRoot/);
    });

    it('closeWelcomeModal forwards modal and backdrop ids', () => {
        const deps = createDeps();
        const helper = createContentModalWelcome(deps);
        helper.closeWelcomeModal({ restoreFocus: true });
        expect(deps.closeManagedModal).toHaveBeenCalledWith('sp-welcome-modal', 'sp-welcome-backdrop', { restoreFocus: true });
    });

    it('createWelcomeFeatureRow builds an icon + title + body block', () => {
        const deps = createDeps();
        const helper = createContentModalWelcome(deps);

        const row = helper.createWelcomeFeatureRow('folder', 'title_key', 'body_key');

        expect(row.className).toBe('sp-welcome-feature-row');
        expect(deps.getMessage).toHaveBeenCalledWith('title_key');
        expect(deps.getMessage).toHaveBeenCalledWith('body_key');
    });

    it('renderWelcomeModal returns false when shadowRoot is missing', () => {
        const deps = createDeps({ getShadowRoot: () => null });
        const helper = createContentModalWelcome(deps);
        expect(helper.renderWelcomeModal()).toBe(false);
        expect(deps.prepareModalOpen).not.toHaveBeenCalled();
    });

    it('renders the modal scaffolding and three feature rows', () => {
        const deps = createDeps();
        const helper = createContentModalWelcome(deps);

        expect(helper.renderWelcomeModal()).toBe(true);

        const shadow = deps.getShadowRoot();
        expect(shadow.querySelector('.sp-welcome-modal')).toBeTruthy();
        expect(shadow.querySelector('.sp-overlay-backdrop')).toBeTruthy();
        expect(shadow.querySelectorAll('.sp-welcome-feature-row')).toHaveLength(3);
    });

    it('clicking the close button marks onboarding seen and closes the modal', async () => {
        const deps = createDeps();
        const helper = createContentModalWelcome(deps);
        helper.renderWelcomeModal();

        const closeBtn = deps.getShadowRoot().querySelector('.sp-welcome-close-btn');
        closeBtn.listeners.click[0]();

        await Promise.resolve();
        expect(deps.markWelcomeOnboardingSeen).toHaveBeenCalledTimes(1);
        expect(deps.closeManagedModal).toHaveBeenCalled();
    });

    it('clicking the get-started primary button also marks seen and closes', async () => {
        const deps = createDeps();
        const helper = createContentModalWelcome(deps);
        helper.renderWelcomeModal();

        const primaryBtn = deps.getShadowRoot().querySelector('.sp-welcome-primary-btn');
        primaryBtn.listeners.click[0]();

        await Promise.resolve();
        expect(deps.markWelcomeOnboardingSeen).toHaveBeenCalledTimes(1);
        expect(deps.closeManagedModal).toHaveBeenCalled();
    });

    it('clicking the feedback link opens the web store and closes the modal', async () => {
        const deps = createDeps();
        const helper = createContentModalWelcome(deps);
        helper.renderWelcomeModal();

        const feedback = deps.getShadowRoot().querySelector('.sp-welcome-feedback-link');
        feedback.listeners.click[0]();

        await Promise.resolve();
        expect(deps.openWebStoreFeedback).toHaveBeenCalledTimes(1);
        expect(deps.closeManagedModal).toHaveBeenCalled();
    });

    it('only marks onboarding seen once even when multiple close paths fire', async () => {
        const deps = createDeps();
        const helper = createContentModalWelcome(deps);
        helper.renderWelcomeModal();

        deps.getShadowRoot().querySelector('.sp-welcome-close-btn').listeners.click[0]();
        deps.getShadowRoot().querySelector('.sp-welcome-primary-btn').listeners.click[0]();
        deps.getShadowRoot().querySelector('.sp-overlay-backdrop').listeners.click[0]();

        await Promise.resolve();
        expect(deps.markWelcomeOnboardingSeen).toHaveBeenCalledTimes(1);
    });

    it('uses requestAnimationFrame to defer visibility when provided', () => {
        const rafCallbacks = [];
        const deps = createDeps({
            requestAnimationFrame: (cb) => { rafCallbacks.push(cb); return rafCallbacks.length; }
        });
        const helper = createContentModalWelcome(deps);
        helper.renderWelcomeModal();

        const modal = deps.getShadowRoot().querySelector('.sp-welcome-modal');
        expect(modal.classList.add).not.toHaveBeenCalled();
        rafCallbacks[0]();
        expect(modal.classList.add).toHaveBeenCalledWith('visible');
    });

    it('falls back to synchronous visibility when requestAnimationFrame is unavailable', () => {
        const deps = createDeps({ requestAnimationFrame: undefined });
        const helper = createContentModalWelcome(deps);
        helper.renderWelcomeModal();

        const modal = deps.getShadowRoot().querySelector('.sp-welcome-modal');
        expect(modal.classList.add).toHaveBeenCalledWith('visible');
    });

    it('binds keyboard navigation with closeAfterSeen as the close handler', () => {
        const deps = createDeps();
        const helper = createContentModalWelcome(deps);
        helper.renderWelcomeModal();

        expect(deps.bindModalKeyboardNavigation).toHaveBeenCalledTimes(1);
        const [, options] = deps.bindModalKeyboardNavigation.mock.calls[0];
        options.closeModal();
        expect(deps.markWelcomeOnboardingSeen).toHaveBeenCalled();
        expect(deps.closeManagedModal).toHaveBeenCalled();
    });
});
