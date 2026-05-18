const createContentToastStatus = require('../../src/content/content-toast-status.js');

describe('content toast/status helper', () => {
    it('normalizes toast options and durations', () => {
        const helper = createContentToastStatus();

        expect(helper.normalizeToastOptions({ variant: 'success', actionLabel: 'Undo', onAction: () => {}, durationMs: 42 })).toMatchObject({
            variant: 'success',
            actionLabel: 'Undo',
            durationMs: 42
        });
        expect(helper.normalizeToastOptions({ variant: 'unknown', durationMs: -1 })).toMatchObject({
            variant: 'info',
            actionLabel: '',
            onAction: null,
            durationMs: null
        });
        expect(helper.getToastDuration({ actionLabel: 'Undo' })).toBe(helper.TOAST_ACTION_DURATION_MS);
        expect(helper.getToastDuration({})).toBe(helper.TOAST_DEFAULT_DURATION_MS);
    });

    it('maps save status names to i18n keys', () => {
        const helper = createContentToastStatus();

        expect(helper.getSaveStatusMessageKey('saving')).toBe('ui_save_status_saving');
        expect(helper.getSaveStatusMessageKey('saved')).toBe('ui_save_status_saved');
        expect(helper.getSaveStatusMessageKey('failed')).toBe('ui_save_status_failed');
        expect(helper.getSaveStatusMessageKey('stale')).toBe('ui_save_status_stale');
        expect(helper.getSaveStatusMessageKey('recovery_available')).toBe('ui_save_status_recovery');
        expect(helper.getSaveStatusMessageKey('idle')).toBe('');
    });

    it('clears element children with and without replaceChildren', () => {
        const helper = createContentToastStatus();
        const replaceChildren = jest.fn();
        helper.clearElementChildren({ replaceChildren });
        expect(replaceChildren).toHaveBeenCalled();

        const child = {};
        const element = {
            childNodes: [child],
            children: [child],
            firstChild: child,
            removeChild: jest.fn(function () {
                this.firstChild = null;
            })
        };
        helper.clearElementChildren(element);
        expect(element.removeChild).toHaveBeenCalledWith(child);
        expect(element.childNodes).toEqual([]);
        expect(element.children).toEqual([]);
    });
});
