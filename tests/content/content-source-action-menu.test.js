const createContentSourceActionMenu = require('../../src/content/content-source-action-menu.js');

describe('content source action menu helper', () => {
    const createMenu = ({
        state = {},
        sources = new Map(),
        canMove = true,
        resolveDirectionalTarget = () => ({ ok: false, reason: 'unavailable', target: null })
    } = {}) => createContentSourceActionMenu({
        getState: () => state,
        getSourcesByKey: () => sources,
        getMessage: (key) => `msg:${key}`,
        canMoveSourceToUngrouped: () => canMove,
        resolveDirectionalTarget
    });

    it('blocks menus for batch mode, loading, disabled, or missing sources', () => {
        expect(createMenu({ sources: new Map([['a', { isLoading: true }]]) }).getSourceActionMenuItems('a')).toEqual([]);
        expect(createMenu({ state: { isBatchMode: true }, sources: new Map([['a', {}]]) }).getSourceActionMenuItems('a')).toEqual([]);
        expect(createMenu({ sources: new Map([['a', { isDisabled: true }]]) }).getSourceActionMenuItems('a')).toEqual([]);
        expect(createMenu().getSourceActionMenuItems('missing')).toEqual([]);
    });

    it('allows failed source menus with only delete failed source action', () => {
        const menu = createMenu({ sources: new Map([['failed', { isFailed: true, isDisabled: true }]]) });

        expect(menu.canOpenSourceActionMenu({ isFailed: true, isDisabled: true })).toBe(true);
        expect(menu.getSourceActionMenuItems('failed')).toEqual([
            {
                action: 'delete-source',
                kind: 'action',
                icon: 'delete',
                label: 'msg:ui_delete_failed_source'
            }
        ]);
    });

    it('returns precise-order submenu state exclusively from the directional resolver', () => {
        const resolveDirectionalTarget = jest.fn((item, direction) => ({
            ok: direction !== 'up',
            reason: direction === 'up' ? 'unavailable' : 'ready',
            target: direction === 'up' ? null : { container: 'root', index: 1 }
        }));
        const menu = createMenu({
            sources: new Map([['ready', {}]]),
            canMove: false,
            resolveDirectionalTarget
        });
        const items = menu.getSourceActionMenuItems('ready');

        expect(items.map((item) => item.action)).toEqual([
            'view-source-details',
            'rename-source',
            'tags',
            'move',
            'move-ungrouped',
            'tree-order',
            'delete-source'
        ]);
        expect(items.find((item) => item.action === 'move-ungrouped')).toMatchObject({ disabled: true });
        const orderItem = items.find((item) => item.action === 'tree-order');
        expect(orderItem).toMatchObject({
            kind: 'submenu',
            icon: 'swap_vert',
            label: 'msg:ui_tree_order'
        });
        expect(menu.getSourceActionSubmenuItems('ready', 'tree-order')).toEqual([
            expect.objectContaining({
                action: 'tree-order-up',
                direction: 'up',
                disabled: true,
                label: 'msg:ui_tree_order_up'
            }),
            expect.objectContaining({
                action: 'tree-order-down',
                direction: 'down',
                disabled: false,
                label: 'msg:ui_tree_order_down'
            }),
            expect.objectContaining({
                action: 'tree-order-in',
                direction: 'in',
                disabled: false,
                label: 'msg:ui_tree_order_in'
            }),
            expect.objectContaining({
                action: 'tree-order-out',
                direction: 'out',
                disabled: false,
                label: 'msg:ui_tree_order_out'
            })
        ]);
        expect(resolveDirectionalTarget).toHaveBeenCalledTimes(8);
        expect(resolveDirectionalTarget).toHaveBeenCalledWith(
            { kind: 'source', key: 'ready' },
            'up'
        );
    });

    it('disables the precise-order parent when every direction is unavailable', () => {
        const menu = createMenu({
            sources: new Map([['only', {}]])
        });

        expect(menu.getSourceActionMenuItems('only').find((item) => (
            item.action === 'tree-order'
        ))).toMatchObject({
            kind: 'submenu',
            disabled: true
        });
    });

    it('creates native action results', () => {
        const menu = createMenu();

        expect(menu.createNativeActionResult(true)).toEqual({ ok: true });
        expect(menu.createNativeActionResult(false, 'menu_missing')).toEqual({ ok: false, reason: 'menu_missing' });
        expect(menu.createNativeActionResult(false)).toEqual({ ok: false, reason: 'native_action_error' });
    });
});
