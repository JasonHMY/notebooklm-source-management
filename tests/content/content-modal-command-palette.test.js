const createContentModalCommandPalette = require('../../src/content/content-modal-command-palette.js');

function createElement(tag, attrs = {}, children = []) {
    const node = {
        tagName: String(tag).toUpperCase(),
        className: attrs.className || '',
        id: attrs.id || '',
        attrs,
        dataset: attrs.dataset || {},
        children: [],
        childNodes: [],
        value: attrs.type === 'text' ? '' : undefined,
        listeners: {},
        addEventListener(event, handler) {
            (this.listeners[event] || (this.listeners[event] = [])).push(handler);
        },
        appendChild(child) {
            this.children.push(child);
            this.childNodes.push(child);
            if (child && typeof child === 'object') child.parentNode = this;
        },
        removeChild(child) {
            this.children = this.children.filter((c) => c !== child);
            this.childNodes = this.childNodes.filter((c) => c !== child);
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
        if (typeof child === 'object') {
            child.parentNode = node;
            node.children.push(child);
            node.childNodes.push(child);
        }
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

function createKeyEvent(key, overrides = {}) {
    return {
        key,
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
        stopImmediatePropagation: jest.fn(),
        ...overrides
    };
}

function createDeps(overrides = {}) {
    const shadowRoot = createElement('div');
    return {
        el: jest.fn(createElement),
        getMessage: jest.fn((key, args = []) => (args.length ? `${key}:${args.join(',')}` : key)),
        getShadowRoot: jest.fn(() => shadowRoot),
        getDocument: jest.fn(() => ({})),
        prepareModalOpen: jest.fn(),
        closeManagedModal: jest.fn(() => true),
        bindModalKeyboardNavigation: jest.fn(() => ({ focusInitial: jest.fn(), dispose: jest.fn() })),
        showToast: jest.fn(),
        getCommandPaletteCommands: jest.fn(() => []),
        executeCommandPaletteCommand: jest.fn(() => true),
        getCommandShortcut: jest.fn(() => ''),
        setCommandShortcut: jest.fn(() => Promise.resolve('ok')),
        getCommandShortcutComboFromEvent: jest.fn(() => ''),
        formatCommandShortcut: jest.fn((s) => String(s || '')),
        requestAnimationFrame: undefined,
        ...overrides
    };
}

describe('content modal command palette', () => {
    it('throws when el/getMessage/getShadowRoot are missing', () => {
        expect(() => createContentModalCommandPalette({})).toThrow(/requires el, getMessage and getShadowRoot/);
    });

    it('closeCommandPaletteModal forwards modal and backdrop ids', () => {
        const deps = createDeps();
        const helper = createContentModalCommandPalette(deps);
        helper.closeCommandPaletteModal({ immediate: true });
        expect(deps.closeManagedModal).toHaveBeenCalledWith('sp-command-palette-modal', 'sp-command-palette-backdrop', { immediate: true });
    });

    it('returns false when shadowRoot or document is missing', () => {
        const helper1 = createContentModalCommandPalette(createDeps({ getShadowRoot: () => null }));
        expect(helper1.renderCommandPaletteModal()).toBe(false);

        const helper2 = createContentModalCommandPalette(createDeps({ getDocument: () => null }));
        expect(helper2.renderCommandPaletteModal()).toBe(false);
    });

    it('renders an empty-state node when no commands match', () => {
        const deps = createDeps({ getCommandPaletteCommands: jest.fn(() => []) });
        const helper = createContentModalCommandPalette(deps);
        helper.renderCommandPaletteModal();

        const emptyState = deps.getShadowRoot().querySelector('.sp-command-palette-empty');
        expect(emptyState).toBeTruthy();
        expect(deps.getMessage).toHaveBeenCalledWith('ui_command_palette_empty');
    });

    it('lists one item per command and marks the first as active', () => {
        const commands = [
            { id: 'a', action: 'go-a', title: 'A' },
            { id: 'b', action: 'go-b', title: 'B' }
        ];
        const deps = createDeps({ getCommandPaletteCommands: jest.fn(() => commands) });
        const helper = createContentModalCommandPalette(deps);
        helper.renderCommandPaletteModal();

        const items = deps.getShadowRoot().querySelectorAll('.sp-command-palette-item');
        expect(items).toHaveLength(2);
        expect(items[0].className).toContain('is-active');
        expect(items[1].className).not.toContain('is-active');
    });

    it('clicking a non-disabled command executes it and closes the palette', () => {
        const commands = [{ id: 'a', action: 'go-a', title: 'A' }];
        const deps = createDeps({ getCommandPaletteCommands: jest.fn(() => commands) });
        const helper = createContentModalCommandPalette(deps);
        helper.renderCommandPaletteModal();

        const item = deps.getShadowRoot().querySelector('.sp-command-palette-item');
        item.listeners.click[0]();

        expect(deps.executeCommandPaletteCommand).toHaveBeenCalledWith('go-a', commands[0]);
        expect(deps.closeManagedModal).toHaveBeenCalledWith('sp-command-palette-modal', 'sp-command-palette-backdrop', { immediate: true });
    });

    it('clicking a disabled command is ignored', () => {
        const commands = [{ id: 'a', action: 'go-a', title: 'A', disabled: true }];
        const deps = createDeps({ getCommandPaletteCommands: jest.fn(() => commands) });
        const helper = createContentModalCommandPalette(deps);
        helper.renderCommandPaletteModal();

        const item = deps.getShadowRoot().querySelector('.sp-command-palette-item');
        item.listeners.click[0]();
        expect(deps.executeCommandPaletteCommand).not.toHaveBeenCalled();
    });

    it('does NOT close when executeCommand returns false', () => {
        const commands = [{ id: 'a', action: 'go-a', title: 'A' }];
        const deps = createDeps({
            getCommandPaletteCommands: jest.fn(() => commands),
            executeCommandPaletteCommand: jest.fn(() => false)
        });
        const helper = createContentModalCommandPalette(deps);
        helper.renderCommandPaletteModal();

        deps.getShadowRoot().querySelector('.sp-command-palette-item').listeners.click[0]();
        expect(deps.closeManagedModal).not.toHaveBeenCalled();
    });

    it('arrow keys move the active index with wrap-around', () => {
        const commands = [
            { id: 'a', action: 'a', title: 'A' },
            { id: 'b', action: 'b', title: 'B' },
            { id: 'c', action: 'c', title: 'C' }
        ];
        const deps = createDeps({ getCommandPaletteCommands: jest.fn(() => commands) });
        const helper = createContentModalCommandPalette(deps);
        helper.renderCommandPaletteModal();

        const input = deps.getShadowRoot().querySelector('.sp-command-palette-input');
        const downEvent = createKeyEvent('ArrowDown');
        const upEvent = createKeyEvent('ArrowUp');

        input.listeners.keydown[0](downEvent);
        input.listeners.keydown[0](downEvent);
        let items = deps.getShadowRoot().querySelectorAll('.sp-command-palette-item');
        expect(items[2].className).toContain('is-active');

        input.listeners.keydown[0](downEvent);
        items = deps.getShadowRoot().querySelectorAll('.sp-command-palette-item');
        expect(items[0].className).toContain('is-active');

        input.listeners.keydown[0](upEvent);
        items = deps.getShadowRoot().querySelectorAll('.sp-command-palette-item');
        expect(items[2].className).toContain('is-active');
    });

    it('Enter executes the active command', () => {
        const commands = [{ id: 'a', action: 'go-a', title: 'A' }];
        const deps = createDeps({ getCommandPaletteCommands: jest.fn(() => commands) });
        const helper = createContentModalCommandPalette(deps);
        helper.renderCommandPaletteModal();

        const input = deps.getShadowRoot().querySelector('.sp-command-palette-input');
        input.listeners.keydown[0](createKeyEvent('Enter'));
        expect(deps.executeCommandPaletteCommand).toHaveBeenCalledWith('go-a', commands[0]);
    });

    it('typing in the input re-queries commands and resets active index', () => {
        const commands = [{ id: 'a', action: 'a', title: 'Apple' }];
        const deps = createDeps({ getCommandPaletteCommands: jest.fn(() => commands) });
        const helper = createContentModalCommandPalette(deps);
        helper.renderCommandPaletteModal();

        const input = deps.getShadowRoot().querySelector('.sp-command-palette-input');
        input.value = 'app';
        input.listeners.input[0]();

        // resolveCommands gets called: once during initial renderItems (with empty input)
        // then twice more on input event (one for the if check, one if resolveCommands is called again)
        // Just confirm it's been called with 'app' at least once.
        const calls = deps.getCommandPaletteCommands.mock.calls.map(([arg]) => arg);
        expect(calls).toContain('app');
    });

    it('mousemove on an item updates the active index to that row', () => {
        const commands = [
            { id: 'a', action: 'a', title: 'A' },
            { id: 'b', action: 'b', title: 'B' }
        ];
        const deps = createDeps({ getCommandPaletteCommands: jest.fn(() => commands) });
        const helper = createContentModalCommandPalette(deps);
        helper.renderCommandPaletteModal();

        const items = deps.getShadowRoot().querySelectorAll('.sp-command-palette-item');
        items[1].listeners.mousemove[0]();
        const refreshed = deps.getShadowRoot().querySelectorAll('.sp-command-palette-item');
        expect(refreshed[1].className).toContain('is-active');
    });

    it('clicking the shortcut button starts shortcut capture mode', () => {
        const commands = [{ id: 'a', action: 'a', title: 'A' }];
        const deps = createDeps({ getCommandPaletteCommands: jest.fn(() => commands) });
        const helper = createContentModalCommandPalette(deps);
        helper.renderCommandPaletteModal();

        const shortcutBtn = deps.getShadowRoot().querySelector('.sp-command-shortcut-btn');
        const evt = { preventDefault: jest.fn(), stopPropagation: jest.fn() };
        shortcutBtn.listeners.click[0](evt);

        expect(evt.preventDefault).toHaveBeenCalled();
        const refreshed = deps.getShadowRoot().querySelector('.sp-command-shortcut-btn');
        expect(refreshed.className).toContain('is-recording');
    });

    it('in capture mode, a keypress writes the resolved combo via setCommandShortcut', async () => {
        const commands = [{ id: 'a', action: 'a', title: 'A' }];
        const deps = createDeps({
            getCommandPaletteCommands: jest.fn(() => commands),
            getCommandShortcutComboFromEvent: jest.fn(() => 'Ctrl+K')
        });
        const helper = createContentModalCommandPalette(deps);
        helper.renderCommandPaletteModal();

        const shortcutBtn = deps.getShadowRoot().querySelector('.sp-command-shortcut-btn');
        shortcutBtn.listeners.click[0]({ preventDefault: jest.fn(), stopPropagation: jest.fn() });

        const modal = deps.getShadowRoot().querySelector('.sp-command-palette-modal');
        modal.listeners.keydown[0](createKeyEvent('K', { ctrlKey: true }));

        await Promise.resolve();
        expect(deps.setCommandShortcut).toHaveBeenCalledWith('a', 'Ctrl+K');
    });

    it('in capture mode, Backspace clears the shortcut by passing an empty string', async () => {
        const commands = [{ id: 'a', action: 'a', title: 'A' }];
        const deps = createDeps({
            getCommandPaletteCommands: jest.fn(() => commands)
        });
        const helper = createContentModalCommandPalette(deps);
        helper.renderCommandPaletteModal();

        const shortcutBtn = deps.getShadowRoot().querySelector('.sp-command-shortcut-btn');
        shortcutBtn.listeners.click[0]({ preventDefault: jest.fn(), stopPropagation: jest.fn() });

        const modal = deps.getShadowRoot().querySelector('.sp-command-palette-modal');
        modal.listeners.keydown[0](createKeyEvent('Backspace'));

        await Promise.resolve();
        expect(deps.setCommandShortcut).toHaveBeenCalledWith('a', '');
    });

    it('in capture mode, Escape cancels capture without writing', () => {
        const commands = [{ id: 'a', action: 'a', title: 'A' }];
        const deps = createDeps({ getCommandPaletteCommands: jest.fn(() => commands) });
        const helper = createContentModalCommandPalette(deps);
        helper.renderCommandPaletteModal();

        const shortcutBtn = deps.getShadowRoot().querySelector('.sp-command-shortcut-btn');
        shortcutBtn.listeners.click[0]({ preventDefault: jest.fn(), stopPropagation: jest.fn() });

        const modal = deps.getShadowRoot().querySelector('.sp-command-palette-modal');
        modal.listeners.keydown[0](createKeyEvent('Escape'));

        expect(deps.setCommandShortcut).not.toHaveBeenCalled();
        const refreshed = deps.getShadowRoot().querySelector('.sp-command-shortcut-btn');
        expect(refreshed.className).not.toContain('is-recording');
    });

    it('shows a toast when setCommandShortcut rejects', async () => {
        const commands = [{ id: 'a', action: 'a', title: 'A' }];
        const deps = createDeps({
            getCommandPaletteCommands: jest.fn(() => commands),
            setCommandShortcut: jest.fn(() => Promise.reject(new Error('boom'))),
            getCommandShortcutComboFromEvent: jest.fn(() => 'Alt+Z')
        });
        const helper = createContentModalCommandPalette(deps);
        helper.renderCommandPaletteModal();

        const shortcutBtn = deps.getShadowRoot().querySelector('.sp-command-shortcut-btn');
        shortcutBtn.listeners.click[0]({ preventDefault: jest.fn(), stopPropagation: jest.fn() });

        const modal = deps.getShadowRoot().querySelector('.sp-command-palette-modal');
        modal.listeners.keydown[0](createKeyEvent('Z', { altKey: true }));

        await new Promise((resolve) => setImmediate(resolve));
        expect(deps.showToast).toHaveBeenCalledWith('ui_command_shortcut_save_failed', { variant: 'error' });
    });

    it('backdrop click closes the modal', () => {
        const deps = createDeps();
        const helper = createContentModalCommandPalette(deps);
        helper.renderCommandPaletteModal();

        const backdrop = deps.getShadowRoot().querySelector('.sp-overlay-backdrop');
        backdrop.listeners.click[0]();
        expect(deps.closeManagedModal).toHaveBeenCalled();
    });
});
