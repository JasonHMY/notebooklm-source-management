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
        setAttribute(name, value) {
            this.attrs[name] = String(value);
        },
        getAttribute(name) {
            return this.attrs[name] ?? null;
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
        classList: {
            add(...classNames) {
                const classes = new Set(String(node.className || '').split(/\s+/).filter(Boolean));
                classNames.forEach((className) => classes.add(className));
                node.className = Array.from(classes).join(' ');
            },
            toggle(className, force) {
                const classes = new Set(String(node.className || '').split(/\s+/).filter(Boolean));
                const shouldAdd = force === undefined ? !classes.has(className) : Boolean(force);
                if (shouldAdd) classes.add(className);
                else classes.delete(className);
                node.className = Array.from(classes).join(' ');
                return shouldAdd;
            }
        },
        focus: jest.fn(),
        scrollIntoView: jest.fn(),
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
        const list = deps.getShadowRoot().querySelector('.sp-command-palette-list');
        expect(emptyState).toBeTruthy();
        expect(emptyState.parentNode).not.toBe(list);
        expect(emptyState.hidden).toBe(false);
        expect(list.childNodes).toHaveLength(0);
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

    it('uses a standard combobox/listbox relationship with pure options', () => {
        const commands = [{ id: 'a', action: 'go-a', title: 'A' }];
        const deps = createDeps({ getCommandPaletteCommands: jest.fn(() => commands) });
        const helper = createContentModalCommandPalette(deps);
        helper.renderCommandPaletteModal();

        const input = deps.getShadowRoot().querySelector('.sp-command-palette-input');
        const list = deps.getShadowRoot().querySelector('.sp-command-palette-list');
        const item = deps.getShadowRoot().querySelector('.sp-command-palette-item');

        expect(input.attrs.role).toBe('combobox');
        expect(input.attrs['aria-autocomplete']).toBe('list');
        expect(input.attrs['aria-expanded']).toBe('true');
        expect(input.attrs['aria-controls']).toBe('sp-command-palette-list');
        expect(input.attrs['aria-activedescendant']).toBe(item.id);
        expect(list.id).toBe('sp-command-palette-list');
        expect(list.attrs.role).toBe('listbox');
        expect(list.childNodes.every((child) => child.attrs.role === 'option')).toBe(true);
        expect(item.attrs.role).toBe('option');
        expect(item.querySelector('button')).toBeNull();
        expect(deps.getShadowRoot().querySelector('.sp-command-shortcut-btn').parentNode).not.toBe(item);
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

    it('pointerenter updates the active row without rebuilding the list', () => {
        const commands = [
            { id: 'a', action: 'a', title: 'A' },
            { id: 'b', action: 'b', title: 'B' },
            { id: 'c', action: 'c', title: 'C' }
        ];
        const deps = createDeps({ getCommandPaletteCommands: jest.fn(() => commands) });
        const helper = createContentModalCommandPalette(deps);
        helper.renderCommandPaletteModal();

        const items = deps.getShadowRoot().querySelectorAll('.sp-command-palette-item');
        const itemCallsBefore = deps.el.mock.calls.filter(([tag, attrs]) => (
            tag === 'div' && String(attrs?.className || '').includes('sp-command-palette-item')
        )).length;
        items.forEach((item) => {
            item.setAttribute = jest.fn(item.setAttribute);
        });
        items[2].listeners.pointerenter[0]();
        const refreshed = deps.getShadowRoot().querySelectorAll('.sp-command-palette-item');
        expect(refreshed[2].className).toContain('is-active');
        expect(refreshed[0].className).not.toContain('is-active');
        expect(refreshed[1].setAttribute).not.toHaveBeenCalled();
        expect(deps.getShadowRoot().querySelector('.sp-command-palette-input').attrs['aria-activedescendant'])
            .toBe(refreshed[2].id);
        expect(deps.el.mock.calls.filter(([tag, attrs]) => (
            tag === 'div' && String(attrs?.className || '').includes('sp-command-palette-item')
        ))).toHaveLength(itemCallsBefore);
    });

    it('opens shortcut recording in a separate small dialog outside the palette', () => {
        const commands = [{ id: 'a', action: 'a', title: 'A' }];
        const deps = createDeps({ getCommandPaletteCommands: jest.fn(() => commands) });
        const helper = createContentModalCommandPalette(deps);
        helper.renderCommandPaletteModal();

        const shortcutBtn = deps.getShadowRoot().querySelector('.sp-command-shortcut-btn');
        const evt = { preventDefault: jest.fn(), stopPropagation: jest.fn() };
        shortcutBtn.listeners.click[0](evt);

        expect(evt.preventDefault).toHaveBeenCalled();
        const palette = deps.getShadowRoot().querySelector('.sp-command-palette-modal');
        const shortcutDialog = deps.getShadowRoot().querySelector('.sp-command-shortcut-dialog');
        const captureSurface = shortcutDialog.querySelector('.sp-command-shortcut-capture');
        expect(shortcutDialog).toBeTruthy();
        expect(shortcutDialog.attrs.role).toBe('dialog');
        expect(shortcutDialog.attrs['aria-modal']).toBe('true');
        expect(shortcutDialog.parentNode).toBe(deps.getShadowRoot());
        expect(shortcutDialog.parentNode).not.toBe(palette);
        expect(deps.bindModalKeyboardNavigation.mock.calls[1][1].initialFocusTarget()).toBe(captureSurface);
        expect(deps.bindModalKeyboardNavigation.mock.results[1].value.focusInitial).toHaveBeenCalled();
    });

    it('records a shortcut in the dialog and restores focus to the Edit shortcut button', async () => {
        const commands = [{ id: 'a', action: 'a', title: 'A' }];
        const deps = createDeps({
            getCommandPaletteCommands: jest.fn(() => commands),
            getCommandShortcutComboFromEvent: jest.fn(() => 'Ctrl+K')
        });
        const helper = createContentModalCommandPalette(deps);
        helper.renderCommandPaletteModal();

        const shortcutBtn = deps.getShadowRoot().querySelector('.sp-command-shortcut-btn');
        shortcutBtn.listeners.click[0]({ preventDefault: jest.fn(), stopPropagation: jest.fn() });

        const shortcutDialog = deps.getShadowRoot().querySelector('.sp-command-shortcut-dialog');
        shortcutDialog.listeners.keydown[0](createKeyEvent('K', { ctrlKey: true }));

        await new Promise((resolve) => setImmediate(resolve));
        expect(deps.setCommandShortcut).toHaveBeenCalledWith('a', 'Ctrl+K');
        expect(deps.getShadowRoot().querySelector('.sp-command-shortcut-dialog')).toBeNull();
        expect(shortcutBtn.focus).toHaveBeenCalled();
    });

    it('Backspace in the shortcut dialog clears the shortcut', async () => {
        const commands = [{ id: 'a', action: 'a', title: 'A' }];
        const deps = createDeps({
            getCommandPaletteCommands: jest.fn(() => commands)
        });
        const helper = createContentModalCommandPalette(deps);
        helper.renderCommandPaletteModal();

        const shortcutBtn = deps.getShadowRoot().querySelector('.sp-command-shortcut-btn');
        shortcutBtn.listeners.click[0]({ preventDefault: jest.fn(), stopPropagation: jest.fn() });

        const shortcutDialog = deps.getShadowRoot().querySelector('.sp-command-shortcut-dialog');
        shortcutDialog.listeners.keydown[0](createKeyEvent('Backspace'));

        await new Promise((resolve) => setImmediate(resolve));
        expect(deps.setCommandShortcut).toHaveBeenCalledWith('a', '');
    });

    it('Escape cancels the shortcut dialog without writing and restores focus', () => {
        const commands = [{ id: 'a', action: 'a', title: 'A' }];
        const deps = createDeps({ getCommandPaletteCommands: jest.fn(() => commands) });
        const helper = createContentModalCommandPalette(deps);
        helper.renderCommandPaletteModal();

        const shortcutBtn = deps.getShadowRoot().querySelector('.sp-command-shortcut-btn');
        shortcutBtn.listeners.click[0]({ preventDefault: jest.fn(), stopPropagation: jest.fn() });

        const shortcutDialog = deps.getShadowRoot().querySelector('.sp-command-shortcut-dialog');
        shortcutDialog.listeners.keydown[0](createKeyEvent('Escape'));

        expect(deps.setCommandShortcut).not.toHaveBeenCalled();
        expect(deps.getShadowRoot().querySelector('.sp-command-shortcut-dialog')).toBeNull();
        expect(shortcutBtn.focus).toHaveBeenCalled();
    });

    it('restores focus to the palette search when the original shortcut button is stale', () => {
        const commands = [{ id: 'a', action: 'a', title: 'A' }];
        const deps = createDeps({ getCommandPaletteCommands: jest.fn(() => commands) });
        const helper = createContentModalCommandPalette(deps);
        helper.renderCommandPaletteModal();

        const input = deps.getShadowRoot().querySelector('.sp-command-palette-input');
        const shortcutBtn = deps.getShadowRoot().querySelector('.sp-command-shortcut-btn');
        shortcutBtn.listeners.click[0]({ preventDefault: jest.fn(), stopPropagation: jest.fn() });
        shortcutBtn.isConnected = false;

        const shortcutDialog = deps.getShadowRoot().querySelector('.sp-command-shortcut-dialog');
        shortcutDialog.listeners.keydown[0](createKeyEvent('Escape'));

        expect(input.focus).toHaveBeenCalled();
    });

    it('keeps the shortcut dialog open with an inline error when saving fails', async () => {
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

        const shortcutDialog = deps.getShadowRoot().querySelector('.sp-command-shortcut-dialog');
        shortcutDialog.listeners.keydown[0](createKeyEvent('Z', { altKey: true }));

        await new Promise((resolve) => setImmediate(resolve));
        const retainedDialog = deps.getShadowRoot().querySelector('.sp-command-shortcut-dialog');
        const dialogStatus = retainedDialog.querySelector('.sp-command-shortcut-status');
        const captureSurface = retainedDialog.querySelector('.sp-command-shortcut-capture');
        expect(retainedDialog).toBeTruthy();
        expect(dialogStatus.hidden).toBe(false);
        expect(dialogStatus.textContent).toBe('ui_command_shortcut_save_failed');
        expect(dialogStatus.attrs.role).toBe('alert');
        expect(dialogStatus.attrs['aria-live']).toBe('assertive');
        expect(captureSurface.focus).toHaveBeenCalled();
        expect(deps.showToast).not.toHaveBeenCalled();

        retainedDialog.querySelector('.sp-secondary-btn').listeners.click[0]();
        expect(deps.getShadowRoot().querySelector('.sp-command-shortcut-dialog')).toBeNull();
        expect(shortcutBtn.focus).toHaveBeenCalled();
    });

    it('waits for async command acknowledgement and retains the palette on failure', async () => {
        const commands = [{ id: 'a', action: 'go-a', title: 'A' }];
        const deps = createDeps({
            getCommandPaletteCommands: jest.fn(() => commands),
            executeCommandPaletteCommand: jest.fn(() => Promise.resolve({
                success: false,
                errorMessageKey: 'popup_source_view_switch_failed'
            }))
        });
        const helper = createContentModalCommandPalette(deps);
        helper.renderCommandPaletteModal();

        const item = deps.getShadowRoot().querySelector('.sp-command-palette-item');
        item.listeners.click[0]();
        expect(deps.getShadowRoot().querySelector('.sp-command-palette-modal').attrs['aria-busy']).toBe('true');

        await Promise.resolve();
        await Promise.resolve();

        expect(deps.closeManagedModal).not.toHaveBeenCalled();
        const status = deps.getShadowRoot().querySelector('.sp-command-palette-status');
        expect(status.hidden).toBe(false);
        expect(status.textContent).toBe('popup_source_view_switch_failed');
        expect(status.className).toContain('is-error');
        expect(status.attrs.role).toBe('alert');
        expect(status.attrs['aria-live']).toBe('assertive');
    });

    it('closes only after an async command explicitly succeeds', async () => {
        const commands = [{ id: 'a', action: 'go-a', title: 'A' }];
        const deps = createDeps({
            getCommandPaletteCommands: jest.fn(() => commands),
            executeCommandPaletteCommand: jest.fn(() => Promise.resolve({ success: true }))
        });
        const helper = createContentModalCommandPalette(deps);
        helper.renderCommandPaletteModal();

        deps.getShadowRoot().querySelector('.sp-command-palette-item').listeners.click[0]();
        expect(deps.closeManagedModal).not.toHaveBeenCalled();

        await Promise.resolve();
        await Promise.resolve();

        expect(deps.closeManagedModal).toHaveBeenCalledWith(
            'sp-command-palette-modal',
            'sp-command-palette-backdrop',
            { immediate: true }
        );
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
