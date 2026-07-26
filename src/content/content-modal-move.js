(function () {
    'use strict';

    /**
     * createContentModalMove(deps) — 源 action 菜单 "Move to folder" modal。
     * 展平 group 树为可选项列表(包含层级缩进),用户选目标后把当前选源 / 批量选中
     * 从原位置移除并插入到目标 group.children。
     *
     * @param {Object} deps Required: el, getMessage, getShadowRoot (缺一抛错).
     *   Required for execute: getState, getGroupsById, getPendingBatchKeys, getSourcesByKey,
     *   saveState, render, removeSourceFromTree, buildParentMap.
     *   Optional: prepareModalOpen, closeManagedModal, bindModalKeyboardNavigation,
     *   createModalItemStaggerStyle, closeSourceActionMenu, requestAnimationFrame.
     * @returns {{ renderMoveToFolderModal, closeMoveToFolderModal,
     *   collectMoveFolderOptions, executeMoveToFolder }}
     *   collectMoveFolderOptions 是 pure helper(给 modal item stagger 渲染用),
     *   executeMoveToFolder 落 state 后 saveState + render。
     */
    function createContentModalMove(deps = {}) {
        const {
            el,
            getMessage,
            getShadowRoot,
            getState,
            getGroupsById,
            getPendingBatchKeys,
            getSourcesByKey,
            prepareModalOpen,
            closeManagedModal,
            bindModalKeyboardNavigation,
            createModalItemStaggerStyle,
            closeSourceActionMenu,
            buildParentMap,
            saveState,
            render,
            removeSourceFromTree,
            requestAnimationFrame: rafFn = globalThis.requestAnimationFrame
        } = deps;

        if (typeof el !== 'function' || typeof getMessage !== 'function' || typeof getShadowRoot !== 'function') {
            throw new Error('GeminiNotebook-Source-Management: createContentModalMove requires el, getMessage and getShadowRoot.');
        }

        function closeMoveToFolderModal(options = {}) {
            return closeManagedModal('sp-move-modal', 'sp-move-backdrop', options);
        }

        function collectMoveFolderOptions(groupIds, level = 0, visitedGroupIds = new Set()) {
            const groupsById = typeof getGroupsById === 'function' ? getGroupsById() : new Map();
            const options = [];

            (Array.isArray(groupIds) ? groupIds : []).forEach((groupId) => {
                if (!groupId || visitedGroupIds.has(groupId)) return;

                const group = groupsById.get(groupId);
                if (!group) return;

                visitedGroupIds.add(groupId);
                options.push({ group, level });

                const childGroupIds = (Array.isArray(group.children) ? group.children : [])
                    .filter((child) => child && child.type === 'group')
                    .map((child) => child.id);
                options.push(...collectMoveFolderOptions(childGroupIds, level + 1, visitedGroupIds));
            });

            return options;
        }

        function executeMoveToFolder(sourceKeys, targetGroupId) {
            const state = (typeof getState === 'function' ? getState() : null) || {};
            const groupsById = typeof getGroupsById === 'function' ? getGroupsById() : new Map();
            const pendingBatchKeys = typeof getPendingBatchKeys === 'function' ? getPendingBatchKeys() : new Set();
            const sourcesByKey = typeof getSourcesByKey === 'function' ? getSourcesByKey() : new Map();
            const targetGroup = groupsById.get(targetGroupId);
            if (!targetGroup) {
                closeMoveToFolderModal();
                return;
            }
            targetGroup.children = Array.isArray(targetGroup.children) ? targetGroup.children : [];

            const keys = Array.isArray(sourceKeys)
                ? sourceKeys
                : (typeof sourceKeys === 'string' ? [sourceKeys] : Array.from(sourceKeys || []));

            keys.forEach((sourceKey) => {
                const sourceData = sourcesByKey.get(sourceKey);
                if (sourceData) {
                    if (typeof removeSourceFromTree === 'function') {
                        removeSourceFromTree(sourceKey);
                    }
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

            if (typeof closeSourceActionMenu === 'function') closeSourceActionMenu();
            if (typeof buildParentMap === 'function') buildParentMap();
            if (typeof saveState === 'function') saveState({ immediate: true, critical: true });
            if (typeof render === 'function') render();
            closeMoveToFolderModal();
        }

        function renderMoveToFolderModal(sourceKeys) {
            const shadowRoot = getShadowRoot();
            if (!shadowRoot || !el) return;

            const keys = Array.isArray(sourceKeys)
                ? sourceKeys
                : (typeof sourceKeys === 'string' ? [sourceKeys] : Array.from(sourceKeys || []));
            if (keys.length === 0) return;

            prepareModalOpen('sp-move-modal', 'sp-move-backdrop');

            const state = (typeof getState === 'function' ? getState() : null) || {};
            const backdrop = el('div', { className: 'sp-overlay-backdrop', id: 'sp-move-backdrop' });
            const modal = el('div', {
                className: 'sp-folder-modal',
                id: 'sp-move-modal',
                role: 'dialog',
                'aria-modal': 'true',
                'aria-labelledby': 'sp-move-modal-title',
                tabindex: '-1'
            });

            const header = el('div', { className: 'sp-folder-modal-header' }, [
                el('h3', { className: 'sp-folder-modal-title', id: 'sp-move-modal-title' }, [getMessage('ui_move_to_folder')])
            ]);

            const content = el('div', { className: 'sp-folder-modal-content' });

            let folderFound = false;
            let modalItemIndex = 0;
            // v5: root folders are the {type:'group'} entries of state.root.
            const groupIds = (Array.isArray(state.root) ? state.root : [])
                .filter((entry) => entry && entry.type === 'group' && entry.id)
                .map((entry) => entry.id);
            const staggerStyle = typeof createModalItemStaggerStyle === 'function'
                ? createModalItemStaggerStyle
                : (index, baseStyle = '') => baseStyle;
            collectMoveFolderOptions(groupIds).forEach(({ group, level }) => {
                if (group) {
                    folderFound = true;
                    const indentStyle = level > 0 ? `padding-left:${12 + (level * 18)}px;` : '';
                    const folderBtn = el('button', {
                        type: 'button',
                        className: 'sp-folder-option',
                        dataset: {
                            groupId: group.id,
                            level: String(level)
                        },
                        style: staggerStyle(modalItemIndex, indentStyle)
                    }, [
                        el('span', { className: 'google-symbols' }, ['folder']),
                        el('span', { className: 'sp-folder-option-title' }, [group.title || getMessage('ui_group_untitled')])
                    ]);
                    modalItemIndex += 1;

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
                el('button', { type: 'button', className: 'sp-modal-cancel' }, [getMessage('ui_cancel')])
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

            const modalKeyboard = bindModalKeyboardNavigation(modal, {
                closeModal: closeMoveToFolderModal,
                initialFocusTarget: () => modal.querySelector('.sp-folder-option') || modal.querySelector('.sp-modal-cancel')
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
        }

        return {
            renderMoveToFolderModal,
            closeMoveToFolderModal,
            collectMoveFolderOptions,
            executeMoveToFolder
        };
    }

    globalThis.NSM_CREATE_CONTENT_MODAL_MOVE = createContentModalMove;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentModalMove;
    }
})();
