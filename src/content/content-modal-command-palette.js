(function () {
    'use strict';

    /**
     * createContentModalCommandPalette(deps) — Ctrl/Cmd+K 命令面板 modal。
     * 列出当前 surface 可执行命令(来自 deps.getCommandPaletteCommands),
     * 支持搜索过滤、键盘上下选择、回车执行、就地编辑快捷键(record-combo 模式)。
     *
     * @param {Object} deps Required: el, getMessage, getShadowRoot (缺一抛错).
     *   Optional: getDocument, prepareModalOpen, closeManagedModal, bindModalKeyboardNavigation,
     *   showToast, getCommandPaletteCommands, executeCommandPaletteCommand,
     *   getCommandShortcut, setCommandShortcut, getCommandShortcutComboFromEvent,
     *   formatCommandShortcut, requestAnimationFrame.
     * @returns {{ renderCommandPaletteModal, closeCommandPaletteModal }}
     *   render 注入 backdrop + modal 到 Shadow DOM 并 focus input;close 走 closeManagedModal。
     */
    function createContentModalCommandPalette(deps = {}) {
        const {
            el,
            getMessage,
            getShadowRoot,
            getDocument,
            prepareModalOpen,
            closeManagedModal,
            bindModalKeyboardNavigation,
            showToast,
            getCommandPaletteCommands,
            executeCommandPaletteCommand,
            getCommandShortcut,
            setCommandShortcut,
            getCommandShortcutComboFromEvent,
            formatCommandShortcut,
            requestAnimationFrame: rafFn = globalThis.requestAnimationFrame
        } = deps;

        if (typeof el !== 'function' || typeof getMessage !== 'function' || typeof getShadowRoot !== 'function') {
            throw new Error('NotebookLM Source Management: createContentModalCommandPalette requires el, getMessage and getShadowRoot.');
        }

        const resolveCommands = typeof getCommandPaletteCommands === 'function'
            ? getCommandPaletteCommands
            : () => [];
        const executeCommand = typeof executeCommandPaletteCommand === 'function'
            ? executeCommandPaletteCommand
            : () => false;
        const resolveShortcut = typeof getCommandShortcut === 'function'
            ? getCommandShortcut
            : () => '';
        const persistShortcut = typeof setCommandShortcut === 'function'
            ? setCommandShortcut
            : () => Promise.resolve('');
        const comboFromEvent = typeof getCommandShortcutComboFromEvent === 'function'
            ? getCommandShortcutComboFromEvent
            : () => '';
        const formatShortcut = typeof formatCommandShortcut === 'function'
            ? formatCommandShortcut
            : (shortcut) => String(shortcut || '');
        const reportToast = typeof showToast === 'function' ? showToast : () => {};

        function closeCommandPaletteModal(options = {}) {
            return closeManagedModal('sp-command-palette-modal', 'sp-command-palette-backdrop', options);
        }

        function renderCommandPaletteModal() {
            const shadowRoot = getShadowRoot();
            const documentObj = typeof getDocument === 'function' ? getDocument() : (typeof document !== 'undefined' ? document : null);
            if (!shadowRoot || !documentObj || !el) return false;

            prepareModalOpen('sp-command-palette-modal', 'sp-command-palette-backdrop');

            const backdrop = el('div', { className: 'sp-overlay-backdrop', id: 'sp-command-palette-backdrop' });
            const modal = el('div', {
                className: 'sp-folder-modal sp-command-palette-modal',
                id: 'sp-command-palette-modal',
                role: 'dialog',
                'aria-modal': 'true',
                'aria-labelledby': 'sp-command-palette-title',
                tabindex: '-1'
            });
            const header = el('div', { className: 'sp-folder-modal-header sp-command-palette-header' }, [
                el('h3', { className: 'sp-folder-modal-title', id: 'sp-command-palette-title' }, [
                    getMessage('ui_command_palette')
                ])
            ]);
            const input = el('input', {
                type: 'text',
                className: 'sp-command-palette-input',
                placeholder: getMessage('ui_command_palette_placeholder'),
                'aria-label': getMessage('ui_command_palette')
            });
            const list = el('div', {
                className: 'sp-command-palette-list',
                role: 'listbox'
            });
            const content = el('div', { className: 'sp-folder-modal-content sp-command-palette-content' }, [
                input,
                list
            ]);
            let commands = [];
            let activeIndex = 0;
            let shortcutCaptureCommandId = null;

            const clearList = () => {
                Array.from(list.childNodes || []).forEach((child) => {
                    if (typeof list.removeChild === 'function') list.removeChild(child);
                });
            };
            const saveCommandShortcut = (commandId, shortcut) => {
                const nextShortcut = String(shortcut || '');
                return Promise.resolve(persistShortcut(commandId, nextShortcut))
                    .then(() => {
                        shortcutCaptureCommandId = null;
                        renderItems();
                        return true;
                    })
                    .catch(() => {
                        shortcutCaptureCommandId = null;
                        reportToast(getMessage('ui_command_shortcut_save_failed'), { variant: 'error' });
                        renderItems();
                        return false;
                    });
            };
            const renderItems = () => {
                commands = Array.isArray(resolveCommands(input.value)) ? resolveCommands(input.value) : [];
                if (activeIndex >= commands.length) activeIndex = Math.max(0, commands.length - 1);
                clearList();
                if (commands.length === 0) {
                    list.appendChild(el('div', { className: 'sp-command-palette-empty' }, [
                        getMessage('ui_command_palette_empty')
                    ]));
                    return;
                }
                commands.forEach((command, index) => {
                    const isActive = index === activeIndex;
                    const commandId = String(command.id || command.action || '');
                    const isCapturingShortcut = Boolean(commandId && shortcutCaptureCommandId === commandId);
                    const shortcut = commandId ? String(resolveShortcut(commandId) || '') : '';
                    const shortcutButtonLabel = isCapturingShortcut
                        ? getMessage('ui_command_shortcut_recording')
                        : (shortcut ? formatShortcut(shortcut) : getMessage('ui_command_shortcut_set'));
                    const shortcutButton = el('button', {
                        type: 'button',
                        className: 'sp-command-shortcut-btn' + (isCapturingShortcut ? ' is-recording' : ''),
                        'aria-label': getMessage(shortcut ? 'ui_command_shortcut_change' : 'ui_command_shortcut_set_for', [command.title || commandId]),
                        title: isCapturingShortcut
                            ? getMessage('ui_command_shortcut_clear_hint')
                            : getMessage(shortcut ? 'ui_command_shortcut_change' : 'ui_command_shortcut_set_for', [command.title || commandId])
                    }, [
                        shortcutButtonLabel
                    ]);
                    const item = el('div', {
                        className: 'sp-command-palette-item' + (isActive ? ' is-active' : '') + (command.disabled ? ' is-disabled' : ''),
                        role: 'option',
                        'aria-selected': isActive ? 'true' : 'false',
                        'aria-disabled': command.disabled ? 'true' : 'false',
                        dataset: { commandIndex: String(index) }
                    }, [
                        el('span', { className: 'google-symbols sp-command-palette-icon', 'aria-hidden': 'true' }, [
                            command.icon || 'chevron_right'
                        ]),
                        el('span', { className: 'sp-command-palette-copy' }, [
                            el('span', { className: 'sp-command-palette-title' }, [command.title || command.id || command.action || '']),
                            command.subtitle
                                ? el('span', { className: 'sp-command-palette-subtitle' }, [command.subtitle])
                                : ''
                        ]),
                        shortcutButton
                    ]);
                    shortcutButton.addEventListener('click', (event) => {
                        event.preventDefault?.();
                        event.stopPropagation?.();
                        if (!commandId) return;
                        shortcutCaptureCommandId = commandId;
                        renderItems();
                        if (typeof modal.focus === 'function') modal.focus();
                    });
                    item.addEventListener('mousemove', () => {
                        activeIndex = index;
                        renderItems();
                    });
                    item.addEventListener('click', () => {
                        if (command.disabled) return;
                        if (executeCommand(command.action, command)) {
                            closeCommandPaletteModal({ immediate: true });
                        }
                    });
                    list.appendChild(item);
                });
            };
            const moveActiveIndex = (delta) => {
                if (commands.length === 0) return;
                activeIndex = (activeIndex + delta + commands.length) % commands.length;
                renderItems();
            };
            const executeActiveCommand = () => {
                const command = commands[activeIndex];
                if (!command || command.disabled) return false;
                if (executeCommand(command.action, command)) {
                    closeCommandPaletteModal({ immediate: true });
                    return true;
                }
                return false;
            };

            input.addEventListener('input', () => {
                activeIndex = 0;
                renderItems();
            });
            modal.addEventListener('keydown', (event) => {
                if (!shortcutCaptureCommandId) return;
                event.preventDefault?.();
                event.stopPropagation?.();
                event.stopImmediatePropagation?.();

                if (event.key === 'Escape') {
                    shortcutCaptureCommandId = null;
                    renderItems();
                    return;
                }
                if (event.key === 'Backspace' || event.key === 'Delete') {
                    const commandId = shortcutCaptureCommandId;
                    saveCommandShortcut(commandId, '');
                    return;
                }

                const shortcut = comboFromEvent(event);
                if (!shortcut) return;
                saveCommandShortcut(shortcutCaptureCommandId, shortcut);
            });
            input.addEventListener('keydown', (event) => {
                if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    moveActiveIndex(1);
                } else if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    moveActiveIndex(-1);
                } else if (event.key === 'Enter') {
                    event.preventDefault();
                    executeActiveCommand();
                }
            });
            backdrop.addEventListener('click', () => closeCommandPaletteModal());

            modal.appendChild(header);
            modal.appendChild(content);
            shadowRoot.appendChild(backdrop);
            shadowRoot.appendChild(modal);
            renderItems();

            const modalKeyboard = bindModalKeyboardNavigation(modal, {
                closeModal: closeCommandPaletteModal,
                initialFocusTarget: () => input
            });
            if (typeof rafFn === 'function') {
                rafFn(() => {
                    backdrop.classList.add('visible');
                    modal.classList.add('visible');
                    modalKeyboard.focusInitial();
                });
            } else {
                backdrop.classList.add('visible');
                modal.classList.add('visible');
                modalKeyboard.focusInitial();
            }
            return true;
        }

        return {
            renderCommandPaletteModal,
            closeCommandPaletteModal
        };
    }

    globalThis.NSM_CREATE_CONTENT_MODAL_COMMAND_PALETTE = createContentModalCommandPalette;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentModalCommandPalette;
    }
})();
