const createContentSourceListScan = require('../../src/content/content-source-list-scan.js');

describe('content source list scan helpers', () => {
    it('reads aria checkbox state before checked property', () => {
        const helpers = createContentSourceListScan();
        const checkbox = {
            checked: false,
            getAttribute: (name) => (name === 'aria-checked' ? 'true' : '')
        };

        expect(helpers.getNativeCheckboxState(checkbox)).toBe(true);
    });

    it('treats mixed and indeterminate checkbox state as unknown', () => {
        const helpers = createContentSourceListScan();

        expect(helpers.getNativeCheckboxState({
            indeterminate: true,
            getAttribute: () => ''
        })).toBeNull();
        expect(helpers.getNativeCheckboxState({
            checked: true,
            getAttribute: (name) => (name === 'aria-checked' ? 'mixed' : '')
        })).toBeNull();
    });

    it('preserves fallback state when native source checkbox is unreadable', () => {
        const helpers = createContentSourceListScan();
        const source = {
            hasNativeCheckbox: true,
            checkbox: { getAttribute: () => '' }
        };

        expect(helpers.getNativeSourceCheckboxState(source, false)).toBe(false);
        expect(helpers.getNativeSourceCheckboxState({ hasNativeCheckbox: false }, false)).toBe(true);
    });
});
