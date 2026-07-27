(function () {
    'use strict';

    /**
     * createContentSourceActionMenu(deps) — 源行右键 action 菜单的 item 列表纯函数。
     * 区分 normal source (查看详情/重命名/打标签/移动/删除) vs failed source (仅删除)。
     * 不渲染 DOM,只生成 `{ action, kind, icon, label, disabled? }[]` 描述,
     * 实际渲染 + 定位在 content-source-actions.js。
     *
     * @param {Object} deps Optional: getState, getSourcesByKey (Map), getMessage,
     *   canMoveSourceToUngrouped(sourceKey), resolveDirectionalTarget(item, direction)
     *   全部有 fallback。
     * @returns {{ canOpenSourceActionMenu, createNativeActionResult, getSourceActionMenuItems, getSourceActionSubmenuItems }}
     *   `canOpenSourceActionMenu`: batch mode / loading 不允许;failed 允许(可删)。
     */
    function createContentSourceActionMenu(deps = {}) {
        const getState = typeof deps.getState === 'function' ? deps.getState : () => ({});
        const getSourcesByKey = typeof deps.getSourcesByKey === 'function' ? deps.getSourcesByKey : () => new Map();
        const getMessage = typeof deps.getMessage === 'function' ? deps.getMessage : (key) => key;
        const canMoveSourceToUngrouped = typeof deps.canMoveSourceToUngrouped === 'function'
            ? deps.canMoveSourceToUngrouped
            : () => false;
        const resolveDirectionalTarget = typeof deps.resolveDirectionalTarget === 'function'
            ? deps.resolveDirectionalTarget
            : () => ({ ok: false, reason: 'unavailable', target: null });

        const TREE_ORDER_ACTIONS = [
            { direction: 'up', icon: 'arrow_upward', labelKey: 'ui_tree_order_up' },
            { direction: 'down', icon: 'arrow_downward', labelKey: 'ui_tree_order_down' },
            { direction: 'in', icon: 'subdirectory_arrow_right', labelKey: 'ui_tree_order_in' },
            { direction: 'out', icon: 'subdirectory_arrow_left', labelKey: 'ui_tree_order_out' }
        ];

        function canOpenSourceActionMenu(source) {
            const state = getState() || {};
            if (!source || state.isBatchMode || source.isLoading) return false;
            if (source.isFailed) return true;
            return !source.isDisabled;
        }

        function createNativeActionResult(ok, reason = '') {
            return ok ? { ok: true } : { ok: false, reason: reason || 'native_action_error' };
        }

        function getSourceActionMenuItems(sourceKey) {
            const source = sourceKey ? getSourcesByKey().get(sourceKey) : null;
            if (!source || !canOpenSourceActionMenu(source)) return [];

            if (source.isFailed) {
                return [
                    {
                        action: 'delete-source',
                        kind: 'action',
                        icon: 'delete',
                        label: getMessage('ui_delete_failed_source')
                    }
                ];
            }

            const treeOrderChildren = TREE_ORDER_ACTIONS.map(({
                direction,
                icon,
                labelKey
            }) => {
                const resolution = resolveDirectionalTarget(
                    { kind: 'source', key: sourceKey },
                    direction
                );
                return {
                    action: `tree-order-${direction}`,
                    kind: 'action',
                    direction,
                    icon,
                    label: getMessage(labelKey),
                    disabled: !resolution?.ok
                };
            });

            return [
                {
                    action: 'view-source-details',
                    kind: 'action',
                    icon: 'description',
                    label: getMessage('ui_view_source_details')
                },
                {
                    action: 'rename-source',
                    kind: 'action',
                    icon: 'edit',
                    label: getMessage('ui_rename_source')
                },
                {
                    action: 'tags',
                    kind: 'action',
                    icon: 'sell',
                    label: getMessage('ui_edit_tags')
                },
                {
                    action: 'move',
                    kind: 'action',
                    icon: 'drive_file_move',
                    label: getMessage('ui_move_to_folder')
                },
                {
                    action: 'move-ungrouped',
                    kind: 'action',
                    icon: 'drive_file_move_rtl',
                    label: getMessage('ui_move_to_ungrouped'),
                    disabled: !canMoveSourceToUngrouped(sourceKey)
                },
                {
                    action: 'tree-order',
                    kind: 'submenu',
                    icon: 'swap_vert',
                    label: getMessage('ui_tree_order'),
                    disabled: treeOrderChildren.every((item) => item.disabled),
                    children: treeOrderChildren
                },
                {
                    action: 'delete-source',
                    kind: 'action',
                    icon: 'delete',
                    label: getMessage('ui_delete_source')
                }
            ];
        }

        function getSourceActionSubmenuItems(sourceKey, submenuAction) {
            const parentItem = getSourceActionMenuItems(sourceKey).find((item) => (
                item.kind === 'submenu' && item.action === submenuAction
            ));
            return Array.isArray(parentItem?.children) ? parentItem.children : [];
        }

        return {
            canOpenSourceActionMenu,
            createNativeActionResult,
            getSourceActionMenuItems,
            getSourceActionSubmenuItems
        };
    }

    globalThis.NSM_CREATE_CONTENT_SOURCE_ACTION_MENU = createContentSourceActionMenu;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentSourceActionMenu;
    }
})();
