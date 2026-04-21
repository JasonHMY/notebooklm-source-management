(function () {
    'use strict';

    function createContentModals(deps = {}) {
        const getDocument = typeof deps.getDocument === 'function'
            ? deps.getDocument
            : () => (typeof document !== 'undefined' ? document : null);
        const getShadowRoot = typeof deps.getShadowRoot === 'function'
            ? deps.getShadowRoot
            : () => (deps.shadowRoot || null);
        const getState = typeof deps.getState === 'function'
            ? deps.getState
            : () => (deps.state || {});
        const getGroupsById = typeof deps.getGroupsById === 'function'
            ? deps.getGroupsById
            : () => (deps.groupsById || new Map());
        const getTagsById = typeof deps.getTagsById === 'function'
            ? deps.getTagsById
            : () => (deps.tagsById || new Map());
        const getSourceTagsById = typeof deps.getSourceTagsById === 'function'
            ? deps.getSourceTagsById
            : () => (deps.sourceTagsById || new Map());
        const getPendingBatchKeys = typeof deps.getPendingBatchKeys === 'function'
            ? deps.getPendingBatchKeys
            : () => (deps.pendingBatchKeys || new Set());
        const getMessage = typeof deps.getMessage === 'function'
            ? deps.getMessage
            : (key) => key;
        const el = typeof deps.el === 'function'
            ? deps.el
            : (typeof globalThis.el === 'function' ? globalThis.el : null);
        const closeSourceActionMenu = typeof deps.closeSourceActionMenu === 'function'
            ? deps.closeSourceActionMenu
            : () => {};
        const render = typeof deps.render === 'function'
            ? deps.render
            : () => {};
        const saveState = typeof deps.saveState === 'function'
            ? deps.saveState
            : () => {};
        const buildParentMap = typeof deps.buildParentMap === 'function'
            ? deps.buildParentMap
            : () => {};
        const removeSourceFromTree = typeof deps.removeSourceFromTree === 'function'
            ? deps.removeSourceFromTree
            : () => {};
        const createTag = typeof deps.createTag === 'function'
            ? deps.createTag
            : () => null;
        const updateTag = typeof deps.updateTag === 'function'
            ? deps.updateTag
            : () => null;
        const deleteTag = typeof deps.deleteTag === 'function'
            ? deps.deleteTag
            : () => {};
        const getTagUsageCounts = typeof deps.getTagUsageCounts === 'function'
            ? deps.getTagUsageCounts
            : () => new Map();
        const getSourceTagIds = typeof deps.getSourceTagIds === 'function'
            ? deps.getSourceTagIds
            : () => [];
        const setSourceTagIds = typeof deps.setSourceTagIds === 'function'
            ? deps.setSourceTagIds
            : () => {};
        const normalizeTagColor = typeof deps.normalizeTagColor === 'function'
            ? deps.normalizeTagColor
            : (value) => value || null;
        const normalizeTagColorInputValue = typeof deps.normalizeTagColorInputValue === 'function'
            ? deps.normalizeTagColorInputValue
            : (value) => String(value || '');
        const getDefaultTagColor = typeof deps.getDefaultTagColor === 'function'
            ? deps.getDefaultTagColor
            : () => '#007AFF';
        const getTagColorPreviewStyle = typeof deps.getTagColorPreviewStyle === 'function'
            ? deps.getTagColorPreviewStyle
            : () => '';

        const TAG_COLOR_PRESETS = [
            '#007AFF',
            '#34C759',
            '#FF9500',
            '#FF3B30',
            '#AF52DE',
            '#5AC8FA',
            '#FF2D55',
            '#8E8E93'
        ];
        const TAG_COLOR_HEX_PATTERN = /^#([0-9A-F]{6})$/;

        function getTagColorRgb(color) {
            const normalizedColor = normalizeTagColor(color);
            if (!normalizedColor) return null;

            return {
                r: parseInt(normalizedColor.slice(1, 3), 16),
                g: parseInt(normalizedColor.slice(3, 5), 16),
                b: parseInt(normalizedColor.slice(5, 7), 16)
            };
        }

        function getTagColorRgba(color, alpha) {
            const rgb = getTagColorRgb(color);
            if (!rgb) return '';
            return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
        }

        function closeMoveToFolderModal() {
            const shadowRoot = getShadowRoot();
            if (!shadowRoot) return;
            const backdrop = shadowRoot.getElementById('sp-move-backdrop');
            const modal = shadowRoot.getElementById('sp-move-modal');

            if (modal && backdrop) {
                modal.classList.remove('visible');
                modal.classList.add('closing');
                backdrop.classList.remove('visible');

                setTimeout(() => {
                    if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
                    if (modal.parentNode) modal.parentNode.removeChild(modal);
                }, 300);
            } else {
                if (backdrop) backdrop.remove();
                if (modal) modal.remove();
            }
        }

        function renderMoveToFolderModal(sourceKeys) {
            const shadowRoot = getShadowRoot();
            if (!shadowRoot || !el) return;

            const keys = Array.isArray(sourceKeys) ? sourceKeys : (typeof sourceKeys === 'string' ? [sourceKeys] : Array.from(sourceKeys));
            if (keys.length === 0) return;

            closeMoveToFolderModal();

            const state = getState() || {};
            const groupsById = getGroupsById();
            const backdrop = el('div', { className: 'sp-overlay-backdrop', id: 'sp-move-backdrop' });
            const modal = el('div', { className: 'sp-folder-modal', id: 'sp-move-modal' });

            const header = el('div', { className: 'sp-folder-modal-header' }, [
                el('h3', { className: 'sp-folder-modal-title' }, [getMessage('ui_move_to_folder')])
            ]);

            const content = el('div', { className: 'sp-folder-modal-content' });

            let folderFound = false;
            const groupIds = Array.isArray(state.groups) ? state.groups : [];
            groupIds.forEach((groupId) => {
                const group = groupsById.get(groupId);
                if (group) {
                    folderFound = true;
                    const folderBtn = el('button', { className: 'sp-folder-option' }, [
                        el('span', { className: 'google-symbols' }, ['folder']),
                        el('span', { className: 'sp-folder-option-title' }, [group.title || getMessage('ui_group_untitled')])
                    ]);

                    folderBtn.addEventListener('click', () => {
                        executeMoveToFolder(keys, group.id);
                    });
                    content.appendChild(folderBtn);
                }
            });

            if (!folderFound) {
                const emptyText = getMessage('ui_empty_folders');
                content.appendChild(el('div', { className: 'sp-folder-empty' }, [emptyText]));
            }

            const footer = el('div', { className: 'sp-folder-modal-footer' }, [
                el('button', { className: 'sp-modal-cancel' }, [getMessage('ui_cancel')])
            ]);

            footer.querySelector('.sp-modal-cancel').addEventListener('click', closeMoveToFolderModal);
            backdrop.addEventListener('click', (e) => {
                if (e.target === backdrop) closeMoveToFolderModal();
            });

            modal.appendChild(header);
            modal.appendChild(content);
            modal.appendChild(footer);

            shadowRoot.appendChild(backdrop);
            shadowRoot.appendChild(modal);

            requestAnimationFrame(() => {
                backdrop.classList.add('visible');
                modal.classList.add('visible');
            });
        }

        function executeMoveToFolder(sourceKeys, targetGroupId) {
            const state = getState() || {};
            const groupsById = getGroupsById();
            const pendingBatchKeys = getPendingBatchKeys();
            const sourcesByKey = typeof deps.getSourcesByKey === 'function' ? deps.getSourcesByKey() : new Map();
            const targetGroup = groupsById.get(targetGroupId);
            if (!targetGroup) {
                closeMoveToFolderModal();
                return;
            }

            const keys = Array.isArray(sourceKeys) ? sourceKeys : (typeof sourceKeys === 'string' ? [sourceKeys] : Array.from(sourceKeys));

            keys.forEach((sourceKey) => {
                const sourceData = sourcesByKey.get(sourceKey);
                if (sourceData) {
                    removeSourceFromTree(sourceKey);
                    targetGroup.children.push({
                        type: 'source',
                        key: sourceKey
                    });
                }
            });

            if (state.isBatchMode && pendingBatchKeys.size > 0) {
                state.isBatchMode = false;
                pendingBatchKeys.clear();
            }

            closeSourceActionMenu();
            buildParentMap();
            saveState({ immediate: true });
            render();
            closeMoveToFolderModal();
        }

        function closeTagModal() {
            const shadowRoot = getShadowRoot();
            if (!shadowRoot) return;
            const backdrop = shadowRoot.getElementById('sp-tag-backdrop');
            const modal = shadowRoot.getElementById('sp-tag-modal');

            if (modal && backdrop) {
                modal.classList.remove('visible');
                modal.classList.add('closing');
                backdrop.classList.remove('visible');

                setTimeout(() => {
                    if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
                    if (modal.parentNode) modal.parentNode.removeChild(modal);
                }, 300);
                return;
            }

            if (backdrop) backdrop.remove();
            if (modal) modal.remove();
        }

        function createTagColorControl(initialColor, options = {}) {
            const {
                allowUnset = false,
                inputIdPrefix = 'sp-tag-color'
            } = options;

            let currentColor = normalizeTagColor(initialColor);
            let fallbackColor = currentColor || getDefaultTagColor();
            if (!currentColor && !allowUnset) {
                currentColor = fallbackColor;
            }

            const presetButtons = [];
            const presetChildren = [];

            if (allowUnset) {
                const neutralButton = el('button', {
                    type: 'button',
                    className: 'sp-tag-color-swatch sp-tag-color-swatch-none',
                    title: getMessage('ui_tag_color_none')
                }, [el('span', { className: 'google-symbols' }, ['block'])]);
                neutralButton.addEventListener('click', () => {
                    currentColor = null;
                    syncColorUi();
                });
                presetButtons.push({ button: neutralButton, color: null });
                presetChildren.push(neutralButton);
            }

            TAG_COLOR_PRESETS.forEach((presetColor) => {
                const presetButton = el('button', {
                    type: 'button',
                    className: 'sp-tag-color-swatch',
                    title: presetColor,
                    style: getTagColorPreviewStyle(presetColor)
                });
                presetButton.addEventListener('click', () => {
                    currentColor = presetColor;
                    fallbackColor = presetColor;
                    syncColorUi();
                });
                presetButtons.push({ button: presetButton, color: presetColor });
                presetChildren.push(presetButton);
            });

            const presetContainer = el('div', {
                className: 'sp-tag-color-presets',
                role: 'list'
            }, presetChildren);
            const colorInput = el('input', {
                id: `${inputIdPrefix}-native`,
                className: 'sp-tag-color-native-input',
                type: 'color',
                value: currentColor || fallbackColor,
                'aria-label': getMessage('ui_tag_color_custom')
            });
            const colorTriggerSwatch = el('span', {
                className: 'sp-tag-color-trigger-swatch',
                style: getTagColorPreviewStyle(currentColor || fallbackColor)
            });
            const colorTrigger = el('button', {
                type: 'button',
                className: 'sp-button sp-tag-color-trigger',
                title: getMessage('ui_tag_color_custom')
            }, [
                colorTriggerSwatch,
                el('span', {}, [getMessage('ui_tag_color_custom')])
            ]);
            const hexInput = el('input', {
                id: `${inputIdPrefix}-hex`,
                className: 'sp-tag-input sp-tag-color-hex',
                type: 'text',
                value: currentColor || '',
                placeholder: getMessage('ui_tag_color_hex'),
                'aria-label': getMessage('ui_tag_color_hex'),
                maxlength: '7',
                autocapitalize: 'characters',
                spellcheck: 'false'
            });

            colorTrigger.addEventListener('click', () => {
                if (typeof colorInput.click === 'function') {
                    colorInput.click();
                }
            });

            colorInput.addEventListener('input', () => {
                const nextColor = normalizeTagColor(colorInput.value);
                if (!nextColor) return;
                currentColor = nextColor;
                fallbackColor = nextColor;
                syncColorUi();
            });

            hexInput.addEventListener('input', () => {
                const nextValue = normalizeTagColorInputValue(hexInput.value);
                if (hexInput.value !== nextValue) {
                    hexInput.value = nextValue;
                }

                const nextColor = normalizeTagColor(nextValue);
                if (nextColor) {
                    currentColor = nextColor;
                    fallbackColor = nextColor;
                    syncColorUi();
                    return;
                }

                if (!nextValue && allowUnset) {
                    currentColor = null;
                    syncColorUi();
                }
            });

            hexInput.addEventListener('blur', () => {
                syncColorUi();
            });

            const root = el('div', { className: 'sp-tag-color-group' }, [
                el('div', { className: 'sp-tag-color-heading' }, [getMessage('ui_tag_color')]),
                presetContainer,
                el('div', { className: 'sp-tag-color-input-row' }, [
                    colorTrigger,
                    colorInput,
                    hexInput
                ])
            ]);

            function syncColorUi() {
                presetButtons.forEach(({ button, color }) => {
                    const isActive = color === currentColor || (!color && !currentColor);
                    button.classList.toggle('is-active', isActive);
                    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
                });

                const displayColor = currentColor || fallbackColor || getDefaultTagColor();
                colorInput.value = displayColor;
                colorTriggerSwatch.setAttribute('style', getTagColorPreviewStyle(displayColor));
                hexInput.value = currentColor || '';
            }

            syncColorUi();

            return {
                root,
                hexInput,
                colorInput,
                getValue: () => currentColor
            };
        }

        function createTagEditor(options = {}) {
            const {
                className = '',
                initialLabel = '',
                initialColor = null,
                submitLabel,
                submitButtonId = '',
                submitButtonClassName = 'sp-button',
                inputId = '',
                allowUnsetColor = false,
                onSubmit,
                onCancel = null
            } = options;

            const labelInput = el('input', {
                id: inputId || null,
                className: 'sp-tag-input',
                placeholder: getMessage('ui_create_tag_placeholder'),
                value: initialLabel
            });
            const colorControl = createTagColorControl(initialColor, {
                allowUnset: allowUnsetColor,
                inputIdPrefix: inputId || 'sp-tag-color'
            });
            const actionChildren = [];

            if (typeof onCancel === 'function') {
                const cancelButton = el('button', {
                    type: 'button',
                    className: 'sp-modal-cancel'
                }, [getMessage('ui_cancel')]);
                cancelButton.addEventListener('click', onCancel);
                actionChildren.push(cancelButton);
            }

            const submitButton = el('button', {
                type: 'button',
                id: submitButtonId || null,
                className: submitButtonClassName
            }, [submitLabel]);
            actionChildren.push(submitButton);

            const root = el('div', {
                className: ['sp-tag-editor', className].filter(Boolean).join(' ')
            }, [
                labelInput,
                colorControl.root,
                el('div', { className: 'sp-tag-editor-actions' }, actionChildren)
            ]);

            const handleSubmit = () => {
                if (typeof onSubmit === 'function') {
                    onSubmit({
                        label: labelInput.value,
                        color: colorControl.getValue()
                    });
                }
            };
            const handleEditorKeydown = (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    handleSubmit();
                    return;
                }

                if (event.key === 'Escape' && typeof onCancel === 'function') {
                    event.preventDefault();
                    onCancel();
                }
            };

            submitButton.addEventListener('click', handleSubmit);
            labelInput.addEventListener('keydown', handleEditorKeydown);
            colorControl.hexInput.addEventListener('keydown', handleEditorKeydown);

            return {
                root,
                labelInput,
                colorControl
            };
        }

        function renderTagModal(sourceKey = null, modalState = null) {
            const shadowRoot = getShadowRoot();
            const state = getState() || {};
            const tagsById = getTagsById();
            const sourceTagsById = getSourceTagsById();
            const sourcesByKey = typeof deps.getSourcesByKey === 'function' ? deps.getSourcesByKey() : new Map();
            if (!shadowRoot || !el) return;

            const normalizedModalState = Array.isArray(modalState)
                ? { draftTagIds: modalState }
                : (modalState && typeof modalState === 'object' ? modalState : {});
            const source = sourceKey ? sourcesByKey.get(sourceKey) : null;
            const selectedTagIds = new Set(sourceKey
                ? (normalizedModalState.draftTagIds || getSourceTagIds(sourceKey))
                : []);
            const usageCounts = getTagUsageCounts();
            const editingTagId = !source ? normalizedModalState.editingTagId || null : null;

            closeTagModal();

            const backdrop = el('div', { className: 'sp-overlay-backdrop', id: 'sp-tag-backdrop' });
            const modal = el('div', { className: 'sp-folder-modal sp-tag-modal', id: 'sp-tag-modal' });
            const title = source ? getMessage('ui_edit_tags') : getMessage('ui_manage_tags');
            const header = el('div', { className: 'sp-folder-modal-header' }, [
                el('h3', { className: 'sp-folder-modal-title' }, [title])
            ]);
            const content = el('div', { className: 'sp-folder-modal-content sp-tag-modal-content' });

            const createEditor = createTagEditor({
                className: 'sp-tag-create-row',
                submitLabel: getMessage('ui_create_tag'),
                submitButtonId: 'sp-create-tag-btn',
                inputId: 'sp-tag-name-input',
                initialColor: getDefaultTagColor(),
                onSubmit: ({ label, color }) => {
                    const newTagId = createTag(label, { color });
                    if (!newTagId) return;

                    createEditor.labelInput.value = '';
                    if (source) {
                        selectedTagIds.add(newTagId);
                        render();
                        saveState({ immediate: true });
                        renderTagModal(sourceKey, { draftTagIds: Array.from(selectedTagIds) });
                        return;
                    }

                    saveState({ immediate: true });
                    render();
                    renderTagModal();
                }
            });
            content.appendChild(createEditor.root);

            const tagOrder = Array.isArray(state.tagOrder) ? state.tagOrder : [];
            if (tagOrder.length === 0) {
                content.appendChild(el('div', { className: 'sp-folder-empty' }, [
                    source ? getMessage('ui_no_tags_for_source') : getMessage('ui_no_tags')
                ]));
            } else if (source) {
                tagOrder.forEach((tagId) => {
                    const tag = tagsById.get(tagId);
                    if (!tag) return;

                    content.appendChild(el('label', { className: 'sp-tag-option' }, [
                        el('input', {
                            type: 'checkbox',
                            className: 'sp-tag-option-checkbox',
                            dataset: { tagId },
                            checked: selectedTagIds.has(tagId)
                        }),
                        el('span', { className: 'sp-tag-option-label' }, [tag.label])
                    ]));
                });
            } else {
                tagOrder.forEach((tagId) => {
                    const tag = tagsById.get(tagId);
                    if (!tag) return;

                    const editButton = el('button', {
                        type: 'button',
                        className: 'sp-tag-row-button sp-edit-tag-btn',
                        dataset: { tagId },
                        title: getMessage('ui_tag_edit_title')
                    }, [el('span', { className: 'google-symbols' }, ['edit'])]);
                    editButton.addEventListener('click', () => {
                        renderTagModal(null, { editingTagId: tagId });
                    });

                    const deleteButton = el('button', {
                        type: 'button',
                        className: 'sp-tag-row-button sp-delete-tag-btn',
                        dataset: { tagId },
                        title: getMessage('ui_tag_delete')
                    }, [el('span', { className: 'google-symbols' }, ['delete'])]);
                    deleteButton.addEventListener('click', () => {
                        const shouldDelete = typeof window === 'undefined' || typeof window.confirm !== 'function'
                            ? true
                            : window.confirm(getMessage('ui_tag_delete_confirm', [tag.label]));
                        if (!shouldDelete) return;

                        deleteTag(tagId);
                        saveState({ immediate: true });
                        render();
                        renderTagModal();
                    });

                    const item = el('div', {
                        className: 'sp-tag-manage-item' + (editingTagId === tagId ? ' is-editing' : '')
                    }, [
                        el('div', { className: 'sp-tag-row' }, [
                            el('span', {
                                className: 'sp-tag-row-color' + (tag.color ? '' : ' is-neutral'),
                                title: tag.color || getMessage('ui_tag_color_none'),
                                style: getTagColorPreviewStyle(tag.color)
                            }),
                            el('span', { className: 'sp-tag-row-label' }, [tag.label]),
                            el('span', { className: 'sp-tag-row-count' }, [String(usageCounts.get(tagId) || 0)]),
                            editButton,
                            deleteButton
                        ])
                    ]);

                    if (editingTagId === tagId) {
                        const editEditor = createTagEditor({
                            className: 'sp-tag-edit-row',
                            initialLabel: tag.label,
                            initialColor: tag.color,
                            submitLabel: getMessage('ui_tag_update'),
                            submitButtonClassName: 'sp-button',
                            inputId: `sp-edit-tag-${tagId}`,
                            allowUnsetColor: true,
                            onCancel: () => renderTagModal(),
                            onSubmit: ({ label, color }) => {
                                const result = updateTag(tagId, { label, color });
                                if (!result || result !== tagId) return;

                                saveState({ immediate: true });
                                render();
                                renderTagModal();
                            }
                        });
                        item.appendChild(editEditor.root);
                    }

                    content.appendChild(item);
                });
            }

            const footerChildren = [
                el('button', { className: 'sp-modal-cancel' }, [getMessage('ui_cancel')])
            ];
            if (source) {
                footerChildren.push(el('button', { className: 'sp-button', id: 'sp-save-tags-btn' }, [getMessage('ui_save')]));
            }
            const footer = el('div', { className: 'sp-folder-modal-footer' }, footerChildren);

            footer.querySelector('.sp-modal-cancel').addEventListener('click', closeTagModal);
            backdrop.addEventListener('click', (event) => {
                if (event.target === backdrop) {
                    closeTagModal();
                }
            });

            modal.appendChild(header);
            modal.appendChild(content);
            modal.appendChild(footer);
            shadowRoot.appendChild(backdrop);
            shadowRoot.appendChild(modal);

            if (source) {
                modal.querySelector('#sp-save-tags-btn').addEventListener('click', () => {
                    const nextTagIds = Array.from(modal.querySelectorAll('.sp-tag-option-checkbox:checked'))
                        .reduce((acc, input) => {
                            const tagId = input.dataset.tagId;
                            if (tagId) acc.push(tagId);
                            return acc;
                        }, []);
                    setSourceTagIds(sourceKey, nextTagIds);
                    saveState({ immediate: true });
                    render();
                    closeTagModal();
                });
            }

            requestAnimationFrame(() => {
                backdrop.classList.add('visible');
                modal.classList.add('visible');

                const focusTarget = editingTagId
                    ? modal.querySelector(`#sp-edit-tag-${editingTagId}`)
                    : modal.querySelector('#sp-tag-name-input');
                if (focusTarget && typeof focusTarget.focus === 'function') {
                    focusTarget.focus();
                }
            });
        }

        return {
            renderMoveToFolderModal,
            closeMoveToFolderModal,
            executeMoveToFolder,
            closeTagModal,
            createTagColorControl,
            createTagEditor,
            renderTagModal
        };
    }

    globalThis.NSM_CREATE_CONTENT_MODALS = createContentModals;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentModals;
    }
})();
