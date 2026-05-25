const createContentNativeCheckboxSync = require('../../src/content/content-native-checkbox-sync.js');

function createCheckbox(overrides = {}) {
    const attrs = overrides.attrs || {};
    return {
        indeterminate: false,
        checked: false,
        getAttribute: (attr) => (attr in attrs ? attrs[attr] : null),
        closest: jest.fn(() => null),
        ...overrides
    };
}

describe('content native checkbox sync', () => {
    describe('getNativeControlAttribute', () => {
        const helper = createContentNativeCheckboxSync();

        it('returns the trimmed attribute string', () => {
            const el = { getAttribute: () => '  hello  ' };
            expect(helper.getNativeControlAttribute(el, 'role')).toBe('hello');
        });

        it('returns empty string for missing element or missing getAttribute', () => {
            expect(helper.getNativeControlAttribute(null, 'role')).toBe('');
            expect(helper.getNativeControlAttribute({}, 'role')).toBe('');
        });

        it('returns empty string when the attribute is absent', () => {
            const el = { getAttribute: () => null };
            expect(helper.getNativeControlAttribute(el, 'role')).toBe('');
        });
    });

    describe('getNativeCheckboxState', () => {
        const helper = createContentNativeCheckboxSync();

        it('returns null for missing checkbox', () => {
            expect(helper.getNativeCheckboxState(null)).toBeNull();
        });

        it('returns null when the checkbox is indeterminate', () => {
            expect(helper.getNativeCheckboxState(createCheckbox({ indeterminate: true }))).toBeNull();
        });

        it('returns null when aria-checked is mixed', () => {
            expect(helper.getNativeCheckboxState(createCheckbox({ attrs: { 'aria-checked': 'mixed' } }))).toBeNull();
        });

        it('returns true when aria-checked is "true"', () => {
            expect(helper.getNativeCheckboxState(createCheckbox({ attrs: { 'aria-checked': 'true' } }))).toBe(true);
        });

        it('returns false when aria-checked is "false"', () => {
            expect(helper.getNativeCheckboxState(createCheckbox({ attrs: { 'aria-checked': 'false' } }))).toBe(false);
        });

        it('falls back to checkbox.checked when aria-checked is missing', () => {
            expect(helper.getNativeCheckboxState(createCheckbox({ checked: true }))).toBe(true);
            expect(helper.getNativeCheckboxState(createCheckbox({ checked: false }))).toBe(false);
        });

        it('returns null when both aria-checked and checked are unavailable', () => {
            const el = { getAttribute: () => null };
            expect(helper.getNativeCheckboxState(el)).toBeNull();
        });
    });

    describe('shouldToggleNativeCheckbox', () => {
        const helper = createContentNativeCheckboxSync();

        it('returns true when the current state is unknown so the caller forces a sync', () => {
            const checkbox = createCheckbox({ indeterminate: true });
            expect(helper.shouldToggleNativeCheckbox(checkbox, true)).toBe(true);
        });

        it('returns true when the current state differs from the desired state', () => {
            const checkbox = createCheckbox({ attrs: { 'aria-checked': 'false' } });
            expect(helper.shouldToggleNativeCheckbox(checkbox, true)).toBe(true);
        });

        it('returns false when the current state already matches the desired state', () => {
            const checkbox = createCheckbox({ attrs: { 'aria-checked': 'true' } });
            expect(helper.shouldToggleNativeCheckbox(checkbox, true)).toBe(false);
        });

        it('coerces the desired state to boolean before comparing', () => {
            const checkbox = createCheckbox({ attrs: { 'aria-checked': 'true' } });
            expect(helper.shouldToggleNativeCheckbox(checkbox, 1)).toBe(false);
            expect(helper.shouldToggleNativeCheckbox(checkbox, 0)).toBe(true);
        });
    });

    describe('resolveDetachedRowEntry', () => {
        it('returns null when no source is given', () => {
            const helper = createContentNativeCheckboxSync();
            expect(helper.resolveDetachedRowEntry(null)).toBeNull();
        });

        it('prefers a fresh row entry returned by the resolveFreshRowEntry callback', () => {
            const freshEntry = { checkbox: { tag: 'fresh' }, row: { tag: 'fresh-row' } };
            const helper = createContentNativeCheckboxSync({
                resolveFreshRowEntry: jest.fn(() => freshEntry),
                findFreshCheckbox: jest.fn(() => ({ tag: 'fallback' }))
            });

            const result = helper.resolveDetachedRowEntry({ key: 'a' });

            expect(result).toBe(freshEntry);
        });

        it('falls back to findFreshCheckbox + closest source-item when no fresh entry exists', () => {
            const closestRow = { tag: 'closest-row' };
            const freshCheckbox = { tag: 'fresh', closest: jest.fn((selector) => (selector === '.source-item' ? closestRow : null)) };
            const helper = createContentNativeCheckboxSync({
                findFreshCheckbox: jest.fn(() => freshCheckbox)
            });

            const result = helper.resolveDetachedRowEntry({ key: 'a' });

            expect(result.checkbox).toBe(freshCheckbox);
            expect(result.row).toBe(closestRow);
            expect(freshCheckbox.closest).toHaveBeenCalledWith('.source-item');
        });

        it('falls back to source.element when closest cannot find a source-item ancestor', () => {
            const sourceElement = { tag: 'source-fallback' };
            const freshCheckbox = { tag: 'fresh', closest: jest.fn(() => null) };
            const helper = createContentNativeCheckboxSync({
                findFreshCheckbox: jest.fn(() => freshCheckbox)
            });

            const result = helper.resolveDetachedRowEntry({ key: 'a', element: sourceElement });

            expect(result.row).toBe(sourceElement);
        });

        it('returns null when neither resolveFreshRowEntry nor findFreshCheckbox yields a checkbox', () => {
            const helper = createContentNativeCheckboxSync({
                findFreshCheckbox: jest.fn(() => null)
            });
            expect(helper.resolveDetachedRowEntry({ key: 'a' })).toBeNull();
        });
    });
});
