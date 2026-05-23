(function () {
    'use strict';

    function createContentModalTag(deps = {}) {
        const {
            el,
            getMessage,
            getShadowRoot,
            getWindow = () => (typeof window !== 'undefined' ? window : null),
            getState,
            getTagsById,
            getSourceTagsById,
            getSourcesByKey,
            getPendingBatchKeys,
            prepareModalOpen,
            closeManagedModal,
            bindModalKeyboardNavigation,
            createModalItemStaggerStyle,
            normalizeTagColor = (value) => value || null,
            normalizeTagColorInputValue = (value) => String(value || ''),
            getDefaultTagColor = () => '#007AFF',
            getTagColorPreviewStyle = () => '',
            tagColorPresets,
            createTag = () => null,
            updateTag = () => null,
            deleteTag = () => {},
            getTagUsageCounts = () => new Map(),
            getSourceTagIds = () => [],
            setSourceTagIds = () => {},
            saveState = () => {},
            render = () => {},
            showToast = () => {},
            showUndoableToast = showToast,
            closeSourceActionMenu = () => {},
            requestAnimationFrame: rafFn = globalThis.requestAnimationFrame
        } = deps;

        if (typeof el !== 'function' || typeof getMessage !== 'function' || typeof getShadowRoot !== 'function') {
            throw new Error('NotebookLM Source Management: createContentModalTag requires el, getMessage and getShadowRoot.');
        }

        const TAG_COLOR_PRESETS = Array.isArray(tagColorPresets) && tagColorPresets.length > 0
            ? tagColorPresets
            : ['#007AFF'];

        function closeTagModal(options = {}) {
            return closeManagedModal('sp-tag-modal', 'sp-tag-backdrop', options);
        }

        function closeBatchTagModal(options = {}) {
            return closeManagedModal('sp-batch-tag-modal', 'sp-batch-tag-backdrop', options);
        }

        function normalizeSourceKeyList(sourceKeys) {
            const rawKeys = Array.isArray(sourceKeys)
                ? sourceKeys
                : (typeof sourceKeys === 'string' ? [sourceKeys] : Array.from(sourceKeys || []));
            const seen = new Set();
            return rawKeys.reduce((acc, key) => {
                if (typeof key !== 'string' || !key || seen.has(key)) return acc;
                seen.add(key);
                acc.push(key);
                return acc;
            }, []);
        }

        function getEditTagInputId(tagId) {
            return `sp-edit-tag-${String(tagId || '').replace(/[^A-Za-z0-9_-]+/g, '_')}`;
        }

        function getCssEscapedId(id) {
            const windowObj = (typeof getWindow === 'function' ? getWindow() : null) || globalThis;
            if (windowObj.CSS && typeof windowObj.CSS.escape === 'function') {
                return windowObj.CSS.escape(id);
            }
            return String(id || '').replace(/[^A-Za-z0-9_-]/g, '\\$&');
        }

        function scheduleVisible(backdrop, modal, modalKeyboard) {
            const apply = () => {
                backdrop.classList.add('visible');
                modal.classList.add('visible');
                modalKeyboard.focusInitial();
            };
            if (typeof rafFn === 'function') rafFn(apply);
            else apply();
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

        function executeBatchTagUpdate(mode, sourceKeys, tagIds) {
            const normalizedMode = mode === 'remove' ? 'remove' : 'add';
            const state = (typeof getState === 'function' ? getState() : null) || {};
            const pendingBatchKeys = typeof getPendingBatchKeys === 'function' ? getPendingBatchKeys() : new Set();
            const sourcesByKey = typeof getSourcesByKey === 'function' ? getSourcesByKey() : new Map();
            const tagsById = typeof getTagsById === 'function' ? getTagsById() : new Map();
            const selectedTagIds = Array.from(tagIds || []).filter((tagId) => tagsById.has(tagId));
            const keys = normalizeSourceKeyList(sourceKeys).filter((sourceKey) => {
                const source = sourcesByKey.get(sourceKey);
                return source && !source.isDisabled && !source.isLoading;
            });

            if (keys.length === 0 || selectedTagIds.length === 0) {
                closeBatchTagModal();
                return false;
            }

            const selectedTagIdSet = new Set(selectedTagIds);
            keys.forEach((sourceKey) => {
                const currentTagIds = getSourceTagIds(sourceKey);
                const nextTagIds = normalizedMode === 'remove'
                    ? currentTagIds.filter((tagId) => !selectedTagIdSet.has(tagId))
                    : Array.from(new Set([...currentTagIds, ...selectedTagIds]));
                setSourceTagIds(sourceKey, nextTagIds);
            });

            state.isBatchMode = false;
            pendingBatchKeys.clear();
            closeSourceActionMenu();
            saveState({ immediate: true, critical: true });
            render();
            closeBatchTagModal();
            showUndoableToast(getMessage(
                normalizedMode === 'remove' ? 'ui_batch_tags_removed_toast' : 'ui_batch_tags_added_toast',
                [String(keys.length)]
            ), { variant: 'success' });
            return true;
        }

        function renderBatchTagModal(mode, sourceKeys, modalState = null) {
            const shadowRoot = getShadowRoot();
            const state = (typeof getState === 'function' ? getState() : null) || {};
            const tagsById = typeof getTagsById === 'function' ? getTagsById() : new Map();
            if (!shadowRoot || !el) return;

            const normalizedMode = mode === 'remove' ? 'remove' : 'add';
            const keys = normalizeSourceKeyList(sourceKeys);
            if (keys.length === 0) return;

            const normalizedModalState = modalState && typeof modalState === 'object' ? modalState : {};
            const selectedTagIds = new Set(normalizedModalState.draftTagIds || []);

            prepareModalOpen('sp-batch-tag-modal', 'sp-batch-tag-backdrop');

            const backdrop = el('div', { className: 'sp-overlay-backdrop', id: 'sp-batch-tag-backdrop' });
            const modal = el('div', {
                className: 'sp-folder-modal sp-tag-modal sp-batch-tag-modal',
                id: 'sp-batch-tag-modal',
                role: 'dialog',
                'aria-modal': 'true',
                'aria-labelledby': 'sp-batch-tag-modal-title',
                tabindex: '-1'
            });
            const titleKey = normalizedMode === 'remove' ? 'ui_batch_remove_tags_title' : 'ui_batch_add_tags_title';
            const header = el('div', { className: 'sp-folder-modal-header' }, [
                el('h3', { className: 'sp-folder-modal-title', id: 'sp-batch-tag-modal-title' }, [getMessage(titleKey)])
            ]);
            const content = el('div', { className: 'sp-folder-modal-content sp-tag-modal-content' });

            if (normalizedMode === 'add') {
                const createEditor = createTagEditor({
                    className: 'sp-tag-create-row',
                    submitLabel: getMessage('ui_create_tag'),
                    submitButtonId: 'sp-create-batch-tag-btn',
                    inputId: 'sp-batch-tag-name-input',
                    initialColor: getDefaultTagColor(),
                    onSubmit: ({ label, color }) => {
                        const newTagId = createTag(label, { color });
                        if (!newTagId) return;

                        selectedTagIds.add(newTagId);
                        saveState({ immediate: true, critical: true });
                        render();
                        renderBatchTagModal(normalizedMode, keys, { draftTagIds: Array.from(selectedTagIds) });
                    }
                });
                content.appendChild(createEditor.root);
            }

            const tagOrder = Array.isArray(state.tagOrder) ? state.tagOrder : [];
            if (tagOrder.length === 0) {
                content.appendChild(el('div', { className: 'sp-folder-empty' }, [
                    normalizedMode === 'remove' ? getMessage('ui_no_tags_to_remove') : getMessage('ui_no_tags')
                ]));
            } else {
                let modalItemIndex = 0;
                tagOrder.forEach((tagId) => {
                    const tag = tagsById.get(tagId);
                    if (!tag) return;

                    content.appendChild(el('label', {
                        className: 'sp-tag-option sp-batch-tag-option',
                        style: createModalItemStaggerStyle(modalItemIndex)
                    }, [
                        el('input', {
                            type: 'checkbox',
                            className: 'sp-tag-option-checkbox sp-batch-tag-option-checkbox',
                            dataset: { tagId },
                            checked: selectedTagIds.has(tagId)
                        }),
                        el('span', {
                            className: 'sp-tag-row-color' + (tag.color ? '' : ' is-neutral'),
                            style: getTagColorPreviewStyle(tag.color)
                        }),
                        el('span', { className: 'sp-tag-option-label' }, [tag.label])
                    ]));
                    modalItemIndex += 1;
                });
            }

            const applyButton = el('button', {
                type: 'button',
                className: 'sp-button',
                id: 'sp-apply-batch-tags-btn',
                disabled: selectedTagIds.size === 0
            }, [getMessage('ui_apply_tags')]);
            const footer = el('div', { className: 'sp-folder-modal-footer' }, [
                el('button', { type: 'button', className: 'sp-modal-cancel' }, [getMessage('ui_cancel')]),
                applyButton
            ]);

            footer.querySelector('.sp-modal-cancel').addEventListener('click', closeBatchTagModal);
            applyButton.addEventListener('click', () => {
                executeBatchTagUpdate(normalizedMode, keys, selectedTagIds);
            });
            backdrop.addEventListener('click', (event) => {
                if (event.target === backdrop) {
                    closeBatchTagModal();
                }
            });

            modal.appendChild(header);
            modal.appendChild(content);
            modal.appendChild(footer);
            shadowRoot.appendChild(backdrop);
            shadowRoot.appendChild(modal);

            modal.querySelectorAll('.sp-batch-tag-option-checkbox').forEach((checkbox) => {
                checkbox.addEventListener('change', () => {
                    const tagId = checkbox.dataset.tagId;
                    if (!tagId) return;
                    if (checkbox.checked) selectedTagIds.add(tagId);
                    else selectedTagIds.delete(tagId);
                    applyButton.disabled = selectedTagIds.size === 0;
                });
            });

            const modalKeyboard = bindModalKeyboardNavigation(modal, {
                closeModal: closeBatchTagModal,
                initialFocusTarget: () => (
                    normalizedMode === 'add'
                        ? modal.querySelector('#sp-batch-tag-name-input')
                        : modal.querySelector('.sp-batch-tag-option-checkbox')
                ) || modal.querySelector('.sp-modal-cancel')
            });

            scheduleVisible(backdrop, modal, modalKeyboard);
        }

        function renderTagModal(sourceKey = null, modalState = null) {
            const shadowRoot = getShadowRoot();
            const state = (typeof getState === 'function' ? getState() : null) || {};
            const tagsById = typeof getTagsById === 'function' ? getTagsById() : new Map();
            const sourceTagsById = typeof getSourceTagsById === 'function' ? getSourceTagsById() : new Map();
            const sourcesByKey = typeof getSourcesByKey === 'function' ? getSourcesByKey() : new Map();
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

            prepareModalOpen('sp-tag-modal', 'sp-tag-backdrop');

            const backdrop = el('div', { className: 'sp-overlay-backdrop', id: 'sp-tag-backdrop' });
            const modal = el('div', {
                className: 'sp-folder-modal sp-tag-modal',
                id: 'sp-tag-modal',
                role: 'dialog',
                'aria-modal': 'true',
                'aria-labelledby': 'sp-tag-modal-title',
                tabindex: '-1'
            });
            const title = source ? getMessage('ui_edit_tags') : getMessage('ui_manage_tags');
            const header = el('div', { className: 'sp-folder-modal-header' }, [
                el('h3', { className: 'sp-folder-modal-title', id: 'sp-tag-modal-title' }, [title])
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
                        saveState({ immediate: true, critical: true });
                        renderTagModal(sourceKey, { draftTagIds: Array.from(selectedTagIds) });
                        return;
                    }

                    saveState({ immediate: true, critical: true });
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
                let modalItemIndex = 0;
                tagOrder.forEach((tagId) => {
                    const tag = tagsById.get(tagId);
                    if (!tag) return;

                    content.appendChild(el('label', {
                        className: 'sp-tag-option',
                        style: createModalItemStaggerStyle(modalItemIndex)
                    }, [
                        el('input', {
                            type: 'checkbox',
                            className: 'sp-tag-option-checkbox',
                            dataset: { tagId },
                            checked: selectedTagIds.has(tagId)
                        }),
                        el('span', { className: 'sp-tag-option-label' }, [tag.label])
                    ]));
                    modalItemIndex += 1;
                });
            } else {
                let modalItemIndex = 0;
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
                        saveState({ immediate: true, critical: true });
                        render();
                        renderTagModal();
                    });

                    const item = el('div', {
                        className: 'sp-tag-manage-item' + (editingTagId === tagId ? ' is-editing' : ''),
                        style: createModalItemStaggerStyle(modalItemIndex)
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
                            inputId: getEditTagInputId(tagId),
                            allowUnsetColor: true,
                            onCancel: () => renderTagModal(),
                            onSubmit: ({ label, color }) => {
                                const result = updateTag(tagId, { label, color });
                                if (!result || result !== tagId) return;

                                saveState({ immediate: true, critical: true });
                                render();
                                renderTagModal();
                            }
                        });
                        item.appendChild(editEditor.root);
                    }

                    content.appendChild(item);
                    modalItemIndex += 1;
                });
            }

            const footerChildren = [
                el('button', { type: 'button', className: 'sp-modal-cancel' }, [getMessage('ui_cancel')])
            ];
            if (source) {
                footerChildren.push(el('button', { type: 'button', className: 'sp-button', id: 'sp-save-tags-btn' }, [getMessage('ui_save')]));
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
                    saveState({ immediate: true, critical: true });
                    render();
                    closeTagModal();
                });
            }

            const modalKeyboard = bindModalKeyboardNavigation(modal, {
                closeModal: closeTagModal,
                initialFocusTarget: () => (
                    editingTagId
                        ? modal.querySelector(`#${getCssEscapedId(getEditTagInputId(editingTagId))}`)
                        : modal.querySelector('#sp-tag-name-input')
                ) || modal.querySelector('.sp-modal-cancel')
            });

            scheduleVisible(backdrop, modal, modalKeyboard);
        }

        return {
            renderTagModal,
            closeTagModal,
            renderBatchTagModal,
            closeBatchTagModal,
            executeBatchTagUpdate,
            createTagEditor,
            createTagColorControl,
            getEditTagInputId,
            getCssEscapedId
        };
    }

    globalThis.NSM_CREATE_CONTENT_MODAL_TAG = createContentModalTag;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentModalTag;
    }
})();
