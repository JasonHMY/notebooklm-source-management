(function () {
    'use strict';

    /**
     * createContentModalMove(deps) — 源 action 菜单 "Move to folder" modal。
     * 展平 group 树为可选项列表(包含层级缩进),用户选目标后把当前选源 / 批量选中
     * 从原位置移除并插入到目标 group.children。
     *
     * @param {Object} deps Required: el, getMessage, getShadowRoot (缺一抛错).
     *   Required for execute: getState, getGroupsById, getSourcesByKey,
     *   getPendingBatchKeys, treePlacement, getParentMap, saveState, render.
     *   Optional: prepareModalOpen, closeManagedModal, bindModalKeyboardNavigation,
     *   createModalItemStaggerStyle, closeSourceActionMenu, requestAnimationFrame.
     * @returns {{ renderMoveToFolderModal, closeMoveToFolderModal,
     *   collectMoveFolderOptions, executeMoveToFolder }}
     *   collectMoveFolderOptions 是 pure helper(给 modal item stagger 渲染用),
     *   executeMoveToFolder 通过 Tree Placement 事务提交后 saveState + render。
     */
    function createContentModalMove(deps = {}) {
        const {
            el,
            getMessage,
            getShadowRoot,
            getState,
            getGroupsById,
            getSourcesByKey,
            getPendingBatchKeys,
            getParentMap,
            treePlacement,
            prepareModalOpen,
            closeManagedModal,
            bindModalKeyboardNavigation,
            createModalItemStaggerStyle,
            closeSourceActionMenu,
            saveState,
            render,
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

        function normalizeMoveItems(sourceKeys) {
            let keys;
            try {
                keys = Array.isArray(sourceKeys)
                    ? sourceKeys
                    : (
                        typeof sourceKeys === 'string'
                            ? [sourceKeys]
                            : Array.from(sourceKeys || [])
                    );
            } catch (error) {
                keys = [];
            }
            return keys.map((key) => ({ kind: 'source', key }));
        }

        function createMoveFailure(items, reason = 'invalid_target') {
            return {
                ok: false,
                changed: false,
                reason,
                moved: [],
                skipped: items.map((item) => ({ item, reason }))
            };
        }

        function mergePreflightSkipped(result, preflightSkipped) {
            if (!Array.isArray(preflightSkipped) || preflightSkipped.length === 0) {
                return result;
            }
            if (!result || typeof result !== 'object') {
                return {
                    ok: false,
                    changed: false,
                    reason: 'invalid_target',
                    moved: [],
                    skipped: preflightSkipped
                };
            }
            const placementSkipped = Array.isArray(result?.skipped) ? result.skipped : [];
            if (result?.ok && result.changed) {
                return {
                    ok: true,
                    changed: true,
                    reason: 'partial',
                    moved: Array.isArray(result.moved) ? result.moved : [],
                    skipped: [...placementSkipped, ...preflightSkipped]
                };
            }
            if (result?.ok && !result.changed) {
                return {
                    ok: false,
                    changed: false,
                    reason: 'not_found',
                    moved: [],
                    skipped: [...placementSkipped, ...preflightSkipped]
                };
            }
            return Object.assign({}, result, {
                skipped: [...placementSkipped, ...preflightSkipped]
            });
        }

        function createUniqueMoveGroupId(groupsById) {
            const baseId = `group_${Date.now()}`;
            if (!groupsById.has(baseId)) return baseId;
            let suffix = 1;
            while (groupsById.has(`${baseId}_${suffix}`)) {
                suffix += 1;
            }
            return `${baseId}_${suffix}`;
        }

        function executeMoveToFolder(sourceKeys, targetGroupId) {
            const state = (typeof getState === 'function' ? getState() : null) || {};
            const groupsById = typeof getGroupsById === 'function' ? getGroupsById() : new Map();
            const sourcesByKey = typeof getSourcesByKey === 'function' ? getSourcesByKey() : null;
            const pendingBatchKeys = typeof getPendingBatchKeys === 'function' ? getPendingBatchKeys() : new Set();
            const items = normalizeMoveItems(sourceKeys);
            const targetGroup = groupsById.get(targetGroupId);
            const parentMap = typeof getParentMap === 'function' ? getParentMap() : null;
            if (
                items.length === 0
                || !targetGroup
                || !(sourcesByKey instanceof Map)
                || !(parentMap instanceof Map)
                || !treePlacement
                || typeof treePlacement.applyBatchPlacement !== 'function'
                || typeof treePlacement.rebuildParentMap !== 'function'
            ) {
                return createMoveFailure(items);
            }
            const liveItems = [];
            const preflightSkipped = [];
            items.forEach((item) => {
                if (
                    item?.kind === 'source'
                    && typeof item.key === 'string'
                    && item.key
                    && sourcesByKey.has(item.key)
                ) {
                    liveItems.push(item);
                    return;
                }
                preflightSkipped.push({
                    item,
                    reason: 'not_found'
                });
            });
            if (liveItems.length === 0) {
                return {
                    ok: false,
                    changed: false,
                    reason: 'not_found',
                    moved: [],
                    skipped: preflightSkipped
                };
            }
            const target = {
                container: 'group',
                groupId: targetGroupId,
                index: Array.isArray(targetGroup.children) ? targetGroup.children.length : 0
            };
            let result;
            try {
                result = treePlacement.applyBatchPlacement({
                    items: liveItems,
                    target
                });
            } catch (error) {
                result = createMoveFailure(liveItems);
            }
            result = mergePreflightSkipped(result, preflightSkipped);
            if (!result?.ok || !result.changed) return result || createMoveFailure(items);

            if (state.isBatchMode && pendingBatchKeys.size > 0) {
                state.isBatchMode = false;
                pendingBatchKeys.clear();
            }

            if (typeof closeSourceActionMenu === 'function') closeSourceActionMenu();
            treePlacement.rebuildParentMap(parentMap);
            if (typeof render === 'function') render();
            if (typeof saveState === 'function') saveState({ immediate: true, critical: true });
            closeMoveToFolderModal();
            return result;
        }

        function createFolderAndMove(sourceKeys, title) {
            const state = (typeof getState === 'function' ? getState() : null) || {};
            const groupsById = typeof getGroupsById === 'function' ? getGroupsById() : new Map();
            const parentMap = typeof getParentMap === 'function' ? getParentMap() : null;
            const normalizedTitle = String(title || '').trim().replace(/\s+/g, ' ').slice(0, 120);
            const items = normalizeMoveItems(sourceKeys);
            if (
                !normalizedTitle
                || !(groupsById instanceof Map)
                || !(parentMap instanceof Map)
                || !treePlacement
                || typeof treePlacement.addGroup !== 'function'
                || typeof treePlacement.removeGroup !== 'function'
                || typeof treePlacement.rebuildParentMap !== 'function'
            ) {
                return createMoveFailure(items, normalizedTitle ? 'invalid_target' : 'invalid_name');
            }

            const group = {
                id: createUniqueMoveGroupId(groupsById),
                title: normalizedTitle,
                children: [],
                enabled: true,
                collapsed: false
            };
            const addResult = treePlacement.addGroup({
                group,
                target: {
                    container: 'root',
                    index: Array.isArray(state.root) ? state.root.length : 0
                }
            });
            if (!addResult?.ok || !addResult.changed) {
                return createMoveFailure(items);
            }

            const moveResult = executeMoveToFolder(sourceKeys, group.id);
            if (moveResult?.ok && moveResult.changed) {
                return Object.assign({}, moveResult, {
                    createdGroupId: group.id
                });
            }

            treePlacement.removeGroup({
                item: { kind: 'group', id: group.id }
            });
            treePlacement.rebuildParentMap(parentMap);
            return moveResult || createMoveFailure(items);
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
            const createInput = el('input', {
                type: 'text',
                className: 'sp-move-new-folder-input',
                maxlength: '120',
                placeholder: getMessage('ui_move_new_folder_placeholder'),
                'aria-label': getMessage('ui_move_new_folder_name'),
                autocomplete: 'off'
            });
            const createButton = el('button', {
                type: 'button',
                className: 'sp-button sp-glare-hover sp-move-create-folder-btn'
            }, [getMessage('ui_move_create_folder')]);
            const createRow = el('div', { className: 'sp-move-create-row' }, [
                createInput,
                createButton
            ]);
            let createSubmitted = false;
            const submitNewFolder = () => {
                if (createSubmitted) return false;
                const normalizedTitle = String(createInput.value || '').trim();
                if (!normalizedTitle) {
                    createInput.setAttribute?.('aria-invalid', 'true');
                    createInput.focus?.();
                    return false;
                }
                createInput.removeAttribute?.('aria-invalid');
                createSubmitted = true;
                createInput.disabled = true;
                createButton.disabled = true;
                const result = createFolderAndMove(keys, normalizedTitle);
                if (!result?.ok || !result.changed) {
                    createSubmitted = false;
                    createInput.disabled = false;
                    createButton.disabled = false;
                    createInput.setAttribute?.('aria-invalid', 'true');
                    createInput.focus?.();
                    return false;
                }
                return true;
            };
            createButton.addEventListener('click', submitNewFolder);
            createInput.addEventListener('input', () => createInput.removeAttribute?.('aria-invalid'));
            createInput.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault?.();
                submitNewFolder();
            });
            content.appendChild(createRow);

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
                initialFocusTarget: () => (
                    modal.querySelector('.sp-folder-option')
                    || modal.querySelector('.sp-move-new-folder-input')
                    || modal.querySelector('.sp-modal-cancel')
                )
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
            executeMoveToFolder,
            createFolderAndMove
        };
    }

    globalThis.NSM_CREATE_CONTENT_MODAL_MOVE = createContentModalMove;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentModalMove;
    }
})();
