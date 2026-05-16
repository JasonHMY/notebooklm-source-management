const createContentNativeLabelScan = require('../../src/content/content-native-label-scan.js');

describe('native label scan helpers', () => {
    it('parses English source counts from label headers', () => {
        const helpers = createContentNativeLabelScan();

        expect(helpers.parseNativeLabelSourceCount('AI Risk 8 sources')).toBe(8);
        expect(helpers.parseNativeLabelSourceCount('Research 12 items')).toBe(12);
    });

    it('parses Chinese source counts from label headers', () => {
        const helpers = createContentNativeLabelScan();

        expect(helpers.parseNativeLabelSourceCount('人工智能 8 个来源')).toBe(8);
        expect(helpers.parseNativeLabelSourceCount('统计 6項目')).toBe(6);
    });

    it('returns null when no count is present', () => {
        const helpers = createContentNativeLabelScan();

        expect(helpers.parseNativeLabelSourceCount('Python 编程语言')).toBeNull();
    });
});
