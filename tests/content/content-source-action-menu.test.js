const createContentSourceActionMenu = require('../../src/content/content-source-action-menu.js');

describe('content source action menu helper', () => {
    const createMenu = ({ state = {}, sources = new Map(), canMove = true } = {}) => createContentSourceActionMenu({
        getState: () => state,
        getSourcesByKey: () => sources,
        getMessage: (key) => `msg:${key}`,
        canMoveSourceToUngrouped: () => canMove
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

    it('returns the standard source menu and move disabled state', () => {
        const menu = createMenu({ sources: new Map([['ready', {}]]), canMove: false });
        const items = menu.getSourceActionMenuItems('ready');

        expect(items.map((item) => item.action)).toEqual([
            'view-source-details',
            'rename-source',
            'tags',
            'move',
            'move-ungrouped',
            'delete-source'
        ]);
        expect(items.find((item) => item.action === 'move-ungrouped')).toMatchObject({ disabled: true });
    });

    it('creates native action results', () => {
        const menu = createMenu();

        expect(menu.createNativeActionResult(true)).toEqual({ ok: true });
        expect(menu.createNativeActionResult(false, 'menu_missing')).toEqual({ ok: false, reason: 'menu_missing' });
        expect(menu.createNativeActionResult(false)).toEqual({ ok: false, reason: 'native_action_error' });
    });
});
