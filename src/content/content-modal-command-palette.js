(function () {
    'use strict';

    /**
     * createContentModalCommandPalette(deps) — Ctrl/Cmd+K 命令面板 modal。
     * 列出当前 surface 可执行命令(来自 deps.getCommandPaletteCommands),
     * 支持搜索过滤、键盘上下选择、回车执行，以及在独立小 dialog 中录制快捷键。
     *
     * @param {Object} deps Required: el, getMessage, getShadowRoot (缺一抛错).
     *   Optional: getDocument, prepareModalOpen, closeManagedModal, bindModalKeyboardNavigation,
     *   getCommandPaletteCommands, executeCommandPaletteCommand,
     *   getCommandShortcut, setCommandShortcut, getCommandShortcutComboFromEvent,
     *   formatCommandShortcut, getCommandExecutionFailureMessage, requestAnimationFrame.
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
            getCommandPaletteCommands,
            executeCommandPaletteCommand,
            getCommandShortcut,
            setCommandShortcut,
            getCommandShortcutComboFromEvent,
            formatCommandShortcut,
            getCommandExecutionFailureMessage,
            requestAnimationFrame: rafFn = globalThis.requestAnimationFrame
        } = deps;

        if (typeof el !== 'function' || typeof getMessage !== 'function' || typeof getShadowRoot !== 'function') {
            throw new Error('GeminiNotebook-Source-Management: createContentModalCommandPalette requires el, getMessage and getShadowRoot.');
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
        const resolveCommandFailureMessage = typeof getCommandExecutionFailureMessage === 'function'
            ? getCommandExecutionFailureMessage
            : (_command, result) => (
                result && typeof result.errorMessageKey === 'string'
                    ? getMessage(result.errorMessageKey)
                    : getMessage('ui_native_action_failed')
            );
        let closeActiveShortcutDialog = null;

        function closeCommandPaletteModal(options = {}) {
            if (typeof closeActiveShortcutDialog === 'function') {
                closeActiveShortcutDialog({ restoreFocus: false });
            }
            return closeManagedModal('sp-command-palette-modal', 'sp-command-palette-backdrop', options);
        }

        function renderCommandPaletteModal() {
            const shadowRoot = getShadowRoot();
            const documentObj = typeof getDocument === 'function' ? getDocument() : (typeof document !== 'undefined' ? document : null);
            if (!shadowRoot || !documentObj || !el) return false;

            if (typeof closeActiveShortcutDialog === 'function') {
                closeActiveShortcutDialog({ restoreFocus: false });
            }
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
                'aria-label': getMessage('ui_command_palette'),
                role: 'combobox',
                autocomplete: 'off',
                'aria-autocomplete': 'list',
                'aria-expanded': 'true',
                'aria-controls': 'sp-command-palette-list',
                'aria-activedescendant': ''
            });
            const list = el('div', {
                id: 'sp-command-palette-list',
                className: 'sp-command-palette-list',
                role: 'listbox',
                'aria-label': getMessage('ui_command_palette')
            });
            const emptyState = el('div', {
                className: 'sp-command-palette-empty',
                role: 'status',
                'aria-live': 'polite',
                hidden: true
            }, [
                getMessage('ui_command_palette_empty')
            ]);
            const status = el('div', {
                className: 'sp-command-palette-status',
                role: 'status',
                'aria-live': 'polite',
                'aria-atomic': 'true',
                hidden: true
            });
            const shortcutButton = el('button', {
                type: 'button',
                className: 'sp-command-shortcut-btn',
                disabled: true
            });
            const shortcutActions = el('div', {
                className: 'sp-command-palette-shortcut-actions'
            }, [
                shortcutButton
            ]);
            const content = el('div', { className: 'sp-folder-modal-content sp-command-palette-content' }, [
                input,
                list,
                emptyState,
                status,
                shortcutActions
            ]);
            let commands = [];
            let activeIndex = 0;
            let presentedActiveItem = null;
            let commandExecutionPending = false;

            const clearList = () => {
                Array.from(list.childNodes || []).forEach((child) => {
                    if (typeof list.removeChild === 'function') list.removeChild(child);
                });
            };
            const setAttribute = (node, name, value) => {
                if (!node) return;
                if (typeof node.setAttribute === 'function') {
                    node.setAttribute(name, String(value));
                    return;
                }
                if (node.attrs && typeof node.attrs === 'object') {
                    node.attrs[name] = String(value);
                }
            };
            const setActiveClass = (item, active) => {
                if (!item) return;
                if (item.classList && typeof item.classList.toggle === 'function') {
                    item.classList.toggle('is-active', active);
                    return;
                }
                const classes = String(item.className || '')
                    .split(/\s+/)
                    .filter(Boolean)
                    .filter((className) => className !== 'is-active');
                if (active) classes.push('is-active');
                item.className = classes.join(' ');
            };
            const getCommandId = (command) => String(command?.id || command?.action || '');
            const getOptionId = (index) => `sp-command-palette-option-${index}`;
            const getActiveCommand = () => commands[activeIndex] || null;
            const setStatus = (message = '', variant = '') => {
                const text = String(message || '');
                status.textContent = text;
                status.hidden = !text;
                status.className = 'sp-command-palette-status' + (variant ? ` is-${variant}` : '');
                setAttribute(status, 'role', variant === 'error' ? 'alert' : 'status');
                setAttribute(status, 'aria-live', variant === 'error' ? 'assertive' : 'polite');
            };
            const focusAfterShortcutDialog = (preferredTarget = shortcutButton) => {
                const paletteIsOpen = Boolean(shadowRoot.querySelector?.('#sp-command-palette-modal'));
                if (!paletteIsOpen) return;
                const target = (
                    preferredTarget &&
                    preferredTarget.disabled !== true &&
                    preferredTarget.isConnected !== false &&
                    typeof preferredTarget.focus === 'function'
                )
                    ? preferredTarget
                    : input;
                if (typeof target.focus !== 'function') return;
                if (typeof rafFn === 'function') {
                    rafFn(() => target.focus());
                    return;
                }
                target.focus();
            };
            const renderShortcutAction = () => {
                const activeCommand = getActiveCommand();
                const commandId = getCommandId(activeCommand);
                const shortcut = commandId ? String(resolveShortcut(commandId) || '') : '';
                const commandTitle = activeCommand?.title || commandId;
                const labelKey = shortcut ? 'ui_command_shortcut_change' : 'ui_command_shortcut_set_for';
                const label = commandId
                    ? getMessage(labelKey, [commandTitle])
                    : getMessage('ui_command_shortcut_set');

                shortcutButton.disabled = !commandId || commandExecutionPending;
                shortcutButton.className = 'sp-command-shortcut-btn';
                shortcutButton.textContent = shortcut ? formatShortcut(shortcut) : getMessage('ui_command_shortcut_set');
                shortcutButton.title = label;
                setAttribute(shortcutButton, 'aria-label', label);
            };
            const updateActivePresentation = (options = {}) => {
                const activeItem = Array.from(list.childNodes || [])[activeIndex] || null;
                if (presentedActiveItem !== activeItem) {
                    if (presentedActiveItem) {
                        setActiveClass(presentedActiveItem, false);
                        setAttribute(presentedActiveItem, 'aria-selected', 'false');
                    }
                    if (activeItem) {
                        setActiveClass(activeItem, true);
                        setAttribute(activeItem, 'aria-selected', 'true');
                    }
                    presentedActiveItem = activeItem;
                }
                setAttribute(
                    input,
                    'aria-activedescendant',
                    commands.length > 0 ? getOptionId(activeIndex) : ''
                );
                renderShortcutAction();
                if (options.scroll && activeItem && typeof activeItem.scrollIntoView === 'function') {
                    activeItem.scrollIntoView({ block: 'nearest' });
                }
            };
            const renderItems = () => {
                const resolvedCommands = resolveCommands(input.value);
                commands = Array.isArray(resolvedCommands) ? resolvedCommands : [];
                if (activeIndex >= commands.length) activeIndex = Math.max(0, commands.length - 1);
                clearList();
                emptyState.hidden = commands.length > 0;
                if (commands.length === 0) {
                    updateActivePresentation();
                    return;
                }
                commands.forEach((command, index) => {
                    const isActive = index === activeIndex;
                    const commandId = getCommandId(command);
                    const shortcut = commandId ? String(resolveShortcut(commandId) || '') : '';
                    const item = el('div', {
                        id: getOptionId(index),
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
                        shortcut
                            ? el('span', {
                                className: 'sp-command-shortcut-display',
                                'aria-hidden': 'true'
                            }, [formatShortcut(shortcut)])
                            : ''
                    ]);
                    item.addEventListener('pointerenter', () => {
                        activeIndex = index;
                        updateActivePresentation();
                    });
                    item.addEventListener('click', () => {
                        if (command.disabled) return;
                        activeIndex = index;
                        updateActivePresentation();
                        void executePaletteCommand(command);
                    });
                    list.appendChild(item);
                });
                updateActivePresentation();
            };
            const moveActiveIndex = (delta) => {
                if (commands.length === 0) return;
                activeIndex = (activeIndex + delta + commands.length) % commands.length;
                updateActivePresentation({ scroll: true });
            };
            const isSuccessfulCommandResult = (result) => (
                result === true ||
                Boolean(result && typeof result === 'object' && (result.success === true || result.ok === true))
            );
            const finishCommandExecution = (command, result) => {
                commandExecutionPending = false;
                setAttribute(modal, 'aria-busy', 'false');
                renderShortcutAction();
                if (isSuccessfulCommandResult(result)) {
                    closeCommandPaletteModal({ immediate: true });
                    return true;
                }
                setStatus(resolveCommandFailureMessage(command, result), 'error');
                return false;
            };
            const failCommandExecution = (command, error) => {
                commandExecutionPending = false;
                setAttribute(modal, 'aria-busy', 'false');
                renderShortcutAction();
                setStatus(resolveCommandFailureMessage(command, error), 'error');
                return false;
            };
            const executePaletteCommand = (command) => {
                if (!command || command.disabled || commandExecutionPending) return false;
                setStatus();
                let result;
                try {
                    result = executeCommand(command.action, command);
                } catch (error) {
                    return failCommandExecution(command, error);
                }
                if (!result || typeof result.then !== 'function') {
                    return finishCommandExecution(command, result);
                }
                commandExecutionPending = true;
                setAttribute(modal, 'aria-busy', 'true');
                renderShortcutAction();
                return Promise.resolve(result)
                    .then((resolvedResult) => finishCommandExecution(command, resolvedResult))
                    .catch((error) => failCommandExecution(command, error));
            };
            const executeActiveCommand = () => executePaletteCommand(getActiveCommand());
            const openShortcutDialog = (command, focusReturnTarget = shortcutButton) => {
                const commandId = getCommandId(command);
                if (!commandId || commandExecutionPending) return false;
                if (typeof closeActiveShortcutDialog === 'function') {
                    closeActiveShortcutDialog({ restoreFocus: false });
                }

                const commandTitle = command?.title || commandId;
                const currentShortcut = String(resolveShortcut(commandId) || '');
                const dialogTitle = getMessage(
                    currentShortcut ? 'ui_command_shortcut_change' : 'ui_command_shortcut_set_for',
                    [commandTitle]
                );
                const shortcutBackdrop = el('div', {
                    className: 'sp-overlay-backdrop sp-command-shortcut-dialog-backdrop visible',
                    id: 'sp-command-shortcut-dialog-backdrop'
                });
                const shortcutDialog = el('div', {
                    className: 'sp-folder-modal sp-command-shortcut-dialog visible',
                    id: 'sp-command-shortcut-dialog',
                    role: 'dialog',
                    'aria-modal': 'true',
                    'aria-labelledby': 'sp-command-shortcut-dialog-title',
                    'aria-describedby': 'sp-command-shortcut-dialog-hint',
                    tabindex: '-1'
                });
                const shortcutHeader = el('div', { className: 'sp-folder-modal-header' }, [
                    el('h3', {
                        className: 'sp-folder-modal-title',
                        id: 'sp-command-shortcut-dialog-title'
                    }, [dialogTitle])
                ]);
                const captureSurface = el('div', {
                    className: 'sp-command-shortcut-capture',
                    tabindex: '0',
                    'aria-label': getMessage('ui_command_shortcut_clear_hint')
                }, [
                    el('span', { className: 'google-symbols', 'aria-hidden': 'true' }, ['keyboard']),
                    el('span', {}, [getMessage('ui_command_shortcut_recording')])
                ]);
                const shortcutHint = el('p', {
                    className: 'sp-command-shortcut-hint',
                    id: 'sp-command-shortcut-dialog-hint'
                }, [
                    getMessage('ui_command_shortcut_clear_hint')
                ]);
                const shortcutStatus = el('div', {
                    className: 'sp-command-shortcut-status',
                    role: 'status',
                    'aria-live': 'polite',
                    'aria-atomic': 'true',
                    hidden: true
                });
                const cancelButton = el('button', {
                    type: 'button',
                    className: 'sp-secondary-btn'
                }, [getMessage('ui_cancel')]);
                const shortcutContent = el('div', { className: 'sp-folder-modal-content sp-command-shortcut-content' }, [
                    captureSurface,
                    shortcutHint,
                    shortcutStatus
                ]);
                const shortcutFooter = el('div', { className: 'sp-folder-modal-footer' }, [cancelButton]);
                let shortcutSavePending = false;
                let shortcutKeyboard = null;

                const setShortcutStatus = (message = '', variant = '') => {
                    const text = String(message || '');
                    shortcutStatus.textContent = text;
                    shortcutStatus.hidden = !text;
                    shortcutStatus.className = 'sp-command-shortcut-status' + (variant ? ` is-${variant}` : '');
                    setAttribute(shortcutStatus, 'role', variant === 'error' ? 'alert' : 'status');
                    setAttribute(shortcutStatus, 'aria-live', variant === 'error' ? 'assertive' : 'polite');
                };
                const removeNode = (node) => {
                    if (node?.parentNode && typeof node.parentNode.removeChild === 'function') {
                        node.parentNode.removeChild(node);
                    } else if (typeof node?.remove === 'function') {
                        node.remove();
                    }
                };
                const closeShortcutDialog = (options = {}) => {
                    const { restoreFocus = true } = options;
                    shortcutKeyboard?.dispose?.();
                    removeNode(shortcutBackdrop);
                    removeNode(shortcutDialog);
                    if (closeActiveShortcutDialog === closeShortcutDialog) {
                        closeActiveShortcutDialog = null;
                    }
                    if (restoreFocus) focusAfterShortcutDialog(focusReturnTarget);
                    return true;
                };
                const saveShortcut = (shortcut) => {
                    if (shortcutSavePending) return;
                    shortcutSavePending = true;
                    setShortcutStatus();
                    setAttribute(shortcutDialog, 'aria-busy', 'true');
                    setAttribute(captureSurface, 'tabindex', '-1');
                    cancelButton.disabled = true;
                    Promise.resolve(persistShortcut(commandId, String(shortcut || '')))
                        .then(() => {
                            shortcutSavePending = false;
                            renderItems();
                            closeShortcutDialog();
                        })
                        .catch(() => {
                            shortcutSavePending = false;
                            setAttribute(shortcutDialog, 'aria-busy', 'false');
                            setAttribute(captureSurface, 'tabindex', '0');
                            cancelButton.disabled = false;
                            setShortcutStatus(getMessage('ui_command_shortcut_save_failed'), 'error');
                            focusAfterShortcutDialog(captureSurface);
                        });
                };
                const handleShortcutKeydown = (event) => {
                    if (event.key === 'Tab') return;
                    if (event.key === 'Escape') {
                        event.preventDefault?.();
                        event.stopPropagation?.();
                        event.stopImmediatePropagation?.();
                        if (!shortcutSavePending) closeShortcutDialog();
                        return;
                    }
                    if (shortcutSavePending) return;
                    if (event.key === 'Backspace' || event.key === 'Delete') {
                        event.preventDefault?.();
                        event.stopPropagation?.();
                        event.stopImmediatePropagation?.();
                        saveShortcut('');
                        return;
                    }
                    const shortcut = comboFromEvent(event);
                    if (!shortcut) return;
                    event.preventDefault?.();
                    event.stopPropagation?.();
                    event.stopImmediatePropagation?.();
                    saveShortcut(shortcut);
                };

                cancelButton.addEventListener('click', () => {
                    if (!shortcutSavePending) closeShortcutDialog();
                });
                shortcutBackdrop.addEventListener('click', () => {
                    if (!shortcutSavePending) closeShortcutDialog();
                });
                shortcutDialog.addEventListener('keydown', handleShortcutKeydown);
                shortcutDialog.appendChild(shortcutHeader);
                shortcutDialog.appendChild(shortcutContent);
                shortcutDialog.appendChild(shortcutFooter);
                shadowRoot.appendChild(shortcutBackdrop);
                shadowRoot.appendChild(shortcutDialog);
                closeActiveShortcutDialog = closeShortcutDialog;
                shortcutKeyboard = bindModalKeyboardNavigation(shortcutDialog, {
                    closeModal: closeShortcutDialog,
                    initialFocusTarget: () => captureSurface
                });
                shortcutKeyboard.focusInitial();
                return true;
            };

            shortcutButton.addEventListener('click', (event) => {
                event.preventDefault?.();
                event.stopPropagation?.();
                setStatus();
                openShortcutDialog(getActiveCommand(), shortcutButton);
            });

            input.addEventListener('input', () => {
                activeIndex = 0;
                setStatus();
                renderItems();
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
                    void executeActiveCommand();
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
