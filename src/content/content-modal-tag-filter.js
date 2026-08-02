(function () {
    'use strict';

    /**
     * createContentModalTagFilter(deps) — quick-view "Filter by tag" modal。
     * 按 state.tagOrder 渲染 tag chip 列表,点击应用 applyTagQuickFilter(tagId)
     * 切换源列表过滤(单选 toggle 模型,关闭即应用)。
     *
     * @param {Object} deps Required: el, getMessage, getShadowRoot (缺一抛错).
     *   Required for action: getState, getTagsById, applyTagQuickFilter.
     *   Optional: prepareModalOpen, closeManagedModal, bindModalKeyboardNavigation, requestAnimationFrame.
     * @returns {{ renderTagFilterModal, closeTagFilterModal }}
     */
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
            throw new Error('GeminiNotebook-Source-Management: createContentModalTagFilter requires el, getMessage and getShadowRoot.');
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
            const normalizeSearchValue = (value) => String(value || '').trim().toLocaleLowerCase();

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
            const tagOptionEntries = tags.map((tag) => {
                const label = String(tag.label || tag.id || '');
                const isActive = String(state.activeTagId || '') === String(tag.id || '');
                const button = el('button', {
                    type: 'button',
                    className: 'sp-tag-filter-option sp-glare-hover' + (isActive ? ' is-active' : ''),
                    dataset: { tagId: tag.id },
                    'aria-pressed': isActive ? 'true' : 'false'
                }, [label]);
                return {
                    button,
                    normalizedLabel: normalizeSearchValue(label)
                };
            });
            const searchInput = tags.length > 0
                ? el('input', {
                    type: 'search',
                    className: 'sp-command-palette-input sp-tag-filter-search',
                    placeholder: getMessage('ui_tag_filter_search'),
                    'aria-label': getMessage('ui_tag_filter_search'),
                    'aria-controls': 'sp-tag-filter-list',
                    'aria-describedby': 'sp-tag-filter-results-count',
                    autocomplete: 'off'
                })
                : null;
            const resultsCount = tags.length > 0
                ? el('div', {
                    className: 'sp-tag-filter-results-count',
                    id: 'sp-tag-filter-results-count',
                    role: 'status',
                    'aria-live': 'polite',
                    'aria-atomic': 'true'
                }, [getMessage('ui_search_results_count', [String(tags.length)])])
                : null;
            const tagList = tags.length > 0
                ? el('div', {
                    className: 'sp-tag-filter-list',
                    id: 'sp-tag-filter-list',
                    role: 'group',
                    'aria-labelledby': 'sp-tag-filter-title'
                }, tagOptionEntries.map(({ button }) => button))
                : null;
            const noMatchingTags = tags.length > 0
                ? el('div', {
                    className: 'sp-settings-empty-state sp-tag-filter-no-results',
                    hidden: true
                }, [getMessage('ui_no_matching_tags')])
                : null;
            const content = el('div', { className: 'sp-folder-modal-content sp-tag-filter-content' }, [
                tags.length === 0
                    ? el('div', { className: 'sp-settings-empty-state' }, [getMessage('ui_no_tags')])
                    : searchInput,
                resultsCount,
                tagList,
                noMatchingTags
            ]);
            const footer = el('div', { className: 'sp-folder-modal-footer' }, [
                el('button', { type: 'button', className: 'sp-button sp-modal-cancel sp-glare-hover' }, [
                    getMessage('ui_cancel')
                ])
            ]);

            tagOptionEntries.forEach(({ button }) => {
                button.addEventListener('click', () => {
                    if (typeof applyTagQuickFilter !== 'function' || button.disabled) return;
                    let result;
                    try {
                        result = applyTagQuickFilter(button.dataset.tagId);
                    } catch (error) {
                        return;
                    }
                    if (!result || typeof result.then !== 'function') {
                        if (result) closeTagFilterModal();
                        return;
                    }
                    button.disabled = true;
                    button.setAttribute?.('aria-busy', 'true');
                    Promise.resolve(result)
                        .then((resolved) => {
                            if (
                                resolved === true
                                || resolved?.success === true
                                || resolved?.ok === true
                            ) {
                                closeTagFilterModal();
                                return;
                            }
                            button.disabled = false;
                            button.removeAttribute?.('aria-busy');
                        })
                        .catch(() => {
                            button.disabled = false;
                            button.removeAttribute?.('aria-busy');
                        });
                });
            });
            if (searchInput) {
                const updateSearchResults = () => {
                    const query = normalizeSearchValue(searchInput.value);
                    let visibleCount = 0;
                    tagOptionEntries.forEach(({ button, normalizedLabel }) => {
                        const matches = !query || normalizedLabel.includes(query);
                        button.hidden = !matches;
                        if (matches) visibleCount += 1;
                    });
                    tagList.hidden = visibleCount === 0;
                    noMatchingTags.hidden = visibleCount !== 0;
                    resultsCount.textContent = getMessage('ui_search_results_count', [String(visibleCount)]);
                };
                searchInput.addEventListener('input', updateSearchResults);
                updateSearchResults();
            }
            footer.querySelector('.sp-modal-cancel')?.addEventListener('click', () => closeTagFilterModal());
            backdrop.addEventListener('click', () => closeTagFilterModal());

            modal.appendChild(header);
            modal.appendChild(content);
            modal.appendChild(footer);
            shadowRoot.appendChild(backdrop);
            shadowRoot.appendChild(modal);

            const modalKeyboard = bindModalKeyboardNavigation(modal, {
                closeModal: closeTagFilterModal,
                initialFocusTarget: () => searchInput || modal.querySelector('.sp-modal-cancel')
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
