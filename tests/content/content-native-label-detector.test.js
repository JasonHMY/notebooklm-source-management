const createContentNativeLabelDetector = require('../../src/content/content-native-label-detector.js');

function createElement(overrides = {}) {
    const attrs = overrides.attrs || {};
    return {
        tagName: overrides.tagName || 'BUTTON',
        textContent: overrides.textContent || '',
        className: overrides.className || '',
        getAttribute: (attr) => (attr in attrs ? attrs[attr] : null),
        ...overrides
    };
}

describe('content native label detector', () => {
    const detector = createContentNativeLabelDetector();

    describe('cleanAccessibleLabelTitle', () => {
        it('strips trailing label/category/group suffixes in English and Chinese', () => {
            expect(detector.cleanAccessibleLabelTitle('Research labels')).toBe('Research');
            expect(detector.cleanAccessibleLabelTitle('Research category')).toBe('Research');
            expect(detector.cleanAccessibleLabelTitle('Research group')).toBe('Research');
            expect(detector.cleanAccessibleLabelTitle('研究 标签')).toBe('研究');
            expect(detector.cleanAccessibleLabelTitle('研究 分组')).toBe('研究');
        });

        it('collapses whitespace and returns empty for empty input', () => {
            expect(detector.cleanAccessibleLabelTitle('  Hello   world  ')).toBe('Hello world');
            expect(detector.cleanAccessibleLabelTitle('')).toBe('');
            expect(detector.cleanAccessibleLabelTitle(null)).toBe('');
        });

        it('preserves the original text if cleanup removes everything', () => {
            expect(detector.cleanAccessibleLabelTitle('labels')).toBe('labels');
        });
    });

    describe('collapseRepeatedNativeLabelTitle', () => {
        it('collapses exact even-token duplications', () => {
            expect(detector.collapseRepeatedNativeLabelTitle('Foo bar Foo bar')).toBe('Foo bar');
        });

        it('leaves text without a clean midpoint duplication alone', () => {
            expect(detector.collapseRepeatedNativeLabelTitle('Foo bar baz')).toBe('Foo bar baz');
            expect(detector.collapseRepeatedNativeLabelTitle('Foo bar foo')).toBe('Foo bar foo');
        });

        it('returns empty for empty input', () => {
            expect(detector.collapseRepeatedNativeLabelTitle('')).toBe('');
        });
    });

    describe('cleanNativeLabelTitleCandidate', () => {
        it('removes expand/collapse prefixes and pipeline icon tokens', () => {
            expect(detector.cleanNativeLabelTitleCandidate('Expand source label Research')).toBe('Research');
            expect(detector.cleanNativeLabelTitleCandidate('展开 研究')).toBe('研究');
        });

        it('strips English source/item count noise', () => {
            expect(detector.cleanNativeLabelTitleCandidate('Research 5 sources')).toBe('Research');
            expect(detector.cleanNativeLabelTitleCandidate('Research 12 items')).toBe('Research');
        });

        it('removes material icon tokens', () => {
            expect(detector.cleanNativeLabelTitleCandidate('keyboard_arrow_right Research')).toBe('Research');
            expect(detector.cleanNativeLabelTitleCandidate('Research more_vert')).toBe('Research');
        });

        it('collapses repeated midpoint after cleanup', () => {
            expect(detector.cleanNativeLabelTitleCandidate('Foo Bar Foo Bar')).toBe('Foo Bar');
        });
    });

    describe('getComparableLabelText / getComparableNativeLabelTitle', () => {
        it('normalizes whitespace and lowercases', () => {
            expect(detector.getComparableLabelText('  Hello   World  ')).toBe('hello world');
        });

        it('combines candidate cleanup with comparable normalization', () => {
            expect(detector.getComparableNativeLabelTitle('Expand source label Research 5 sources'))
                .toBe('research');
        });
    });

    describe('isLikelyNativeLabelTitle', () => {
        it('accepts a clean label-style title', () => {
            expect(detector.isLikelyNativeLabelTitle('Research')).toBe(true);
            expect(detector.isLikelyNativeLabelTitle('研究')).toBe(true);
        });

        it('rejects strings longer than 120 chars', () => {
            const longTitle = 'X'.repeat(130);
            expect(detector.isLikelyNativeLabelTitle(longTitle)).toBe(false);
        });

        it('rejects reserved generic titles', () => {
            expect(detector.isLikelyNativeLabelTitle('Sources')).toBe(false);
            expect(detector.isLikelyNativeLabelTitle('来源')).toBe(false);
            expect(detector.isLikelyNativeLabelTitle('Sources for X')).toBe(false);
        });

        it('rejects blocked UI text like loading, source guide, more options', () => {
            expect(detector.isLikelyNativeLabelTitle('Source guide')).toBe(false);
            expect(detector.isLikelyNativeLabelTitle('Loading')).toBe(false);
            expect(detector.isLikelyNativeLabelTitle('More options')).toBe(false);
        });

        it('rejects select-all and native source control wording', () => {
            expect(detector.isLikelyNativeLabelTitle('Select all')).toBe(false);
            expect(detector.isLikelyNativeLabelTitle('Add source')).toBe(false);
        });

        it('rejects relabel/recategorize control text', () => {
            expect(detector.isLikelyNativeLabelTitle('Relabel')).toBe(false);
            expect(detector.isLikelyNativeLabelTitle('Recategorize')).toBe(false);
        });

        it('rejects label entry point text such as auto-label or label-by-topic', () => {
            expect(detector.isLikelyNativeLabelTitle('Auto label sources')).toBe(false);
            expect(detector.isLikelyNativeLabelTitle('Label sources by topic')).toBe(false);
        });

        it('rejects when the candidate matches the row identity title', () => {
            const rowIdentity = { title: 'My research' };
            expect(detector.isLikelyNativeLabelTitle('My research', rowIdentity)).toBe(false);
        });

        it('rejects titles with no alphanumeric or CJK glyphs', () => {
            expect(detector.isLikelyNativeLabelTitle('!!!')).toBe(false);
            expect(detector.isLikelyNativeLabelTitle('   ')).toBe(false);
        });
    });

    describe('isNativeLabelEntryPointControl', () => {
        it('returns true for elements whose accessible text mentions auto-label', () => {
            const el = createElement({ attrs: { 'aria-label': 'Auto label sources by topic' } });
            expect(detector.isNativeLabelEntryPointControl(el)).toBe(true);
        });

        it('returns true for Chinese auto-label wording', () => {
            const el = createElement({ textContent: '按主题来源加标签' });
            expect(detector.isNativeLabelEntryPointControl(el)).toBe(true);
        });

        it('returns false for unrelated buttons', () => {
            const el = createElement({ textContent: 'Add source' });
            expect(detector.isNativeLabelEntryPointControl(el)).toBe(false);
        });

        it('returns false for null/undefined elements', () => {
            expect(detector.isNativeLabelEntryPointControl(null)).toBe(false);
            expect(detector.isNativeLabelEntryPointControl(undefined)).toBe(false);
        });
    });

    describe('isNativeSourceViewSwitchControl', () => {
        it('returns true for a button whose text matches the view switch pattern', () => {
            const el = createElement({ tagName: 'BUTTON', textContent: 'List view' });
            expect(detector.isNativeSourceViewSwitchControl(el)).toBe(true);
        });

        it('returns true for an interactive element with a matching data-testid identifier', () => {
            const el = createElement({
                attrs: {
                    role: 'tab',
                    'data-testid': 'source-view-switch',
                    'aria-pressed': 'false'
                },
                textContent: 'switch'
            });
            expect(detector.isNativeSourceViewSwitchControl(el)).toBe(true);
        });

        it('returns false for static text without any interactive role', () => {
            const el = createElement({ tagName: 'SPAN', textContent: 'List view' });
            expect(detector.isNativeSourceViewSwitchControl(el)).toBe(false);
        });

        it('returns false for an interactive button whose text/identity does not match', () => {
            const el = createElement({ tagName: 'BUTTON', textContent: 'Delete row' });
            expect(detector.isNativeSourceViewSwitchControl(el)).toBe(false);
        });
    });

    describe('returned patterns', () => {
        it('exposes the regex constants used by source-sync', () => {
            expect(detector.ACTIVE_LABEL_VIEW_CONTROL_PATTERN).toBeInstanceOf(RegExp);
            expect(detector.NATIVE_LABEL_ENTRY_POINT_TEXT_PATTERN).toBeInstanceOf(RegExp);
            expect(detector.SOURCE_VIEW_SWITCH_TEXT_PATTERN).toBeInstanceOf(RegExp);
        });
    });
});
