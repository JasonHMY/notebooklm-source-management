const createContentNativeLabelImportModal = require('../../src/content/content-native-label-import-modal.js');

function createMockEl(tag, attrs = {}, children = []) {
    const node = {
        tag,
        className: attrs.className || '',
        childNodes: [],
        get textContent() {
            return this.childNodes.map((child) => (
                typeof child === 'string' ? child : child?.textContent || ''
            )).join('');
        }
    };
    node.childNodes = Array.isArray(children) ? children : [children];
    return node;
}

describe('native label import modal helper', () => {
    it('creates an empty preview node when preview is unavailable', () => {
        const helper = createContentNativeLabelImportModal({
            el: createMockEl,
            getMessage: (key) => key
        });

        const nodes = helper.createPreviewNodes({ ok: false });

        expect(nodes).toHaveLength(1);
        expect(nodes[0].className).toBe('sp-native-label-import-empty');
        expect(nodes[0].textContent).toBe('ui_import_native_labels_preview_empty');
    });

    it('creates preview nodes for reuse and create actions', () => {
        const helper = createContentNativeLabelImportModal({
            el: createMockEl,
            getMessage: (key, placeholders = []) => `${key}:${placeholders.join(',')}`,
            createModalItemStaggerStyle: (index) => `--i:${index};`
        });

        const nodes = helper.createPreviewNodes({
            ok: true,
            labelCount: 2,
            sourceCount: 5,
            labels: [
                { title: 'AI Risk', action: 'reuse', sourceCount: 1, sourceTitles: ['A'] },
                { title: 'Python', action: 'create', sourceCount: 4, sourceTitles: ['B', 'C', 'D', 'E', 'F'] }
            ]
        });

        expect(nodes[0].className).toBe('sp-native-label-import-summary');
        expect(nodes[1].textContent).toContain('ui_import_native_labels_preview_reuse');
        expect(nodes[2].textContent).toContain('ui_import_native_labels_preview_create');
        expect(nodes[2].textContent).toContain('ui_import_native_labels_preview_more:1');
    });
});
