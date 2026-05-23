(function () {
    'use strict';

    function createContentModalTagFilter(deps = {}) {
        const {
            el,
            getMessage,
            getShadowRoot,
            getState,
            getTagsById,
            prepareModalOpen,
            closeManagedModal,
            bindModalKeyboardNavigation,
            applyTagQuickFilter,
            requestAnimationFrame: rafFn = globalThis.requestAnimationFrame
        } = deps;

        if (typeof el !== 'function' || typeof getMessage !== 'function' || typeof getShadowRoot !== 'function') {
            throw new Error('NotebookLM Source Management: createContentModalTagFilter requires el, getMessage and getShadowRoot.');
        }

        function closeTagFilterModal(options = {}) {
            return closeManagedModal('sp-tag-filter-modal', 'sp-tag-filter-backdrop', options);
        }

        function renderTagFilterModal() {
            const shadowRoot = getShadowRoot();
            if (!shadowRoot || !el) return false;
            const state = (typeof getState === 'function' ? getState() : null) || {};
            const tagsById = (typeof getTagsById === 'function' ? getTagsById() : null) || new Map();
            const tagOrder = Array.isArray(state.tagOrder) ? state.tagOrder : [];
            const orderedTagIds = [
                ...tagOrder,
                ...Array.from(tagsById.keys()).filter((tagId) => !tagOrder.includes(tagId))
            ];
            const tags = orderedTagIds
                .map((tagId) => tagsById.get(tagId))
                .filter(Boolean);

            prepareModalOpen('sp-tag-filter-modal', 'sp-tag-filter-backdrop');

            const backdrop = el('div', { className: 'sp-overlay-backdrop', id: 'sp-tag-filter-backdrop' });
            const modal = el('div', {
                className: 'sp-folder-modal sp-tag-filter-modal',
                id: 'sp-tag-filter-modal',
                role: 'dialog',
                'aria-modal': 'true',
                'aria-labelledby': 'sp-tag-filter-title',
                tabindex: '-1'
            });
            const header = el('div', { className: 'sp-folder-modal-header' }, [
                el('h3', { className: 'sp-folder-modal-title', id: 'sp-tag-filter-title' }, [
                    getMessage('ui_tag_filter_title')
                ])
            ]);
            const content = el('div', { className: 'sp-folder-modal-content sp-tag-filter-content' }, [
                tags.length === 0
                    ? el('div', { className: 'sp-settings-empty-state' }, [getMessage('ui_no_tags')])
                    : el('div', { className: 'sp-tag-filter-list' }, tags.map((tag) => (
                        el('button', {
                            type: 'button',
                            className: 'sp-tag-filter-option sp-glare-hover',
                            dataset: { tagId: tag.id }
                        }, [tag.label || tag.id])
                    )))
            ]);
            const footer = el('div', { className: 'sp-folder-modal-footer' }, [
                el('button', { type: 'button', className: 'sp-button sp-modal-cancel sp-glare-hover' }, [
                    getMessage('ui_cancel')
                ])
            ]);

            content.querySelectorAll?.('.sp-tag-filter-option')?.forEach((button) => {
                button.addEventListener('click', () => {
                    if (typeof applyTagQuickFilter === 'function' && applyTagQuickFilter(button.dataset.tagId)) {
                        closeTagFilterModal();
                    }
                });
            });
            footer.querySelector('.sp-modal-cancel')?.addEventListener('click', () => closeTagFilterModal());
            backdrop.addEventListener('click', () => closeTagFilterModal());

            modal.appendChild(header);
            modal.appendChild(content);
            modal.appendChild(footer);
            shadowRoot.appendChild(backdrop);
            shadowRoot.appendChild(modal);

            const modalKeyboard = bindModalKeyboardNavigation(modal, {
                closeModal: closeTagFilterModal,
                initialFocusTarget: () => modal.querySelector('.sp-tag-filter-option') || modal.querySelector('.sp-modal-cancel')
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
            renderTagFilterModal,
            closeTagFilterModal
        };
    }

    globalThis.NSM_CREATE_CONTENT_MODAL_TAG_FILTER = createContentModalTagFilter;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentModalTagFilter;
    }
})();
