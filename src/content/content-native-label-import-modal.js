(function () {
    'use strict';

    function createContentNativeLabelImportModal(deps = {}) {
        const el = typeof deps.el === 'function' ? deps.el : globalThis.el;
        const getMessage = typeof deps.getMessage === 'function' ? deps.getMessage : (key) => key;
        const createModalItemStaggerStyle = typeof deps.createModalItemStaggerStyle === 'function'
            ? deps.createModalItemStaggerStyle
            : () => '';

        function getNativeLabelImportActionKey(label) {
            return label?.action === 'reuse'
                ? 'ui_import_native_labels_preview_reuse'
                : 'ui_import_native_labels_preview_create';
        }

        function createPreviewNodes(preview = {}) {
            if (!preview.ok) {
                return [
                    el('div', { className: 'sp-native-label-import-empty' }, [
                        getMessage('ui_import_native_labels_preview_empty')
                    ])
                ];
            }

            const labels = Array.isArray(preview.labels) ? preview.labels : [];
            const nodes = [
                el('p', { className: 'sp-native-label-import-summary' }, [
                    getMessage('ui_import_native_labels_preview_summary', [
                        String(preview.labelCount || labels.length || 0),
                        String(preview.sourceCount || 0)
                    ])
                ])
            ];

            labels.forEach((label, index) => {
                const sourceTitles = Array.isArray(label.sourceTitles) ? label.sourceTitles : [];
                const visibleSourceTitles = sourceTitles.slice(0, 4);
                const remainingCount = Math.max(0, sourceTitles.length - visibleSourceTitles.length);
                nodes.push(el('div', {
                    className: 'sp-native-label-import-item',
                    style: createModalItemStaggerStyle(index)
                }, [
                    el('div', { className: 'sp-native-label-import-item-header' }, [
                        el('span', { className: 'google-symbols' }, [
                            label.action === 'reuse' ? 'folder_open' : 'create_new_folder'
                        ]),
                        el('span', { className: 'sp-native-label-import-title' }, [
                            label.title || getMessage('ui_group_untitled')
                        ]),
                        el('span', { className: 'sp-native-label-import-count' }, [
                            getMessage('ui_import_native_labels_preview_source_count', [
                                String(label.sourceCount || sourceTitles.length || 0)
                            ])
                        ])
                    ]),
                    el('div', { className: 'sp-native-label-import-action' }, [
                        getMessage(getNativeLabelImportActionKey(label))
                    ]),
                    visibleSourceTitles.length > 0
                        ? el('ul', { className: 'sp-native-label-import-source-list' }, [
                            ...visibleSourceTitles.map((title) => el('li', {}, [
                                title || getMessage('ui_source_untitled')
                            ])),
                            ...(remainingCount > 0
                                ? [el('li', { className: 'sp-native-label-import-more' }, [
                                    getMessage('ui_import_native_labels_preview_more', [String(remainingCount)])
                                ])]
                                : [])
                        ])
                        : el('div', { className: 'sp-native-label-import-source-list sp-native-label-import-source-list-empty' }, [
                            getMessage('ui_import_native_labels_preview_no_sources')
                        ])
                ]));
            });

            return nodes;
        }

        return {
            getNativeLabelImportActionKey,
            createPreviewNodes
        };
    }

    globalThis.NSM_CREATE_CONTENT_NATIVE_LABEL_IMPORT_MODAL = createContentNativeLabelImportModal;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentNativeLabelImportModal;
    }
})();
