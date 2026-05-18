(function () {
    'use strict';

    function createContentSourceActionMenu(deps = {}) {
        const getState = typeof deps.getState === 'function' ? deps.getState : () => ({});
        const getSourcesByKey = typeof deps.getSourcesByKey === 'function' ? deps.getSourcesByKey : () => new Map();
        const getMessage = typeof deps.getMessage === 'function' ? deps.getMessage : (key) => key;
        const canMoveSourceToUngrouped = typeof deps.canMoveSourceToUngrouped === 'function'
            ? deps.canMoveSourceToUngrouped
            : () => false;

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
