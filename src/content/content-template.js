(function () {
    'use strict';

    function createManagerShell(el, chromeOrGetMessage) {
        const getMessage = typeof chromeOrGetMessage === 'function'
            ? chromeOrGetMessage
            : (key) => chromeOrGetMessage?.i18n?.getMessage?.(key) || key;
        return el('div', { className: 'sp-container' }, [
            el('div', { className: 'sp-controls' }, [
                el('div', { className: 'sp-toolbar-actions' }, [
                    el('button', {
                        id: 'sp-settings-btn',
                        className: 'sp-icon-button sp-toolbar-settings sp-glare-hover',
                        title: getMessage("ui_settings"),
                        'aria-label': getMessage("ui_settings")
                    }, [
                        el('span', { className: 'google-symbols' }, ['settings'])
                    ]),
                    el('button', {
                        id: 'sp-command-palette-btn',
                        className: 'sp-icon-button sp-command-palette-trigger sp-glare-hover',
                        title: getMessage("ui_command_palette"),
                        'aria-label': getMessage("ui_command_palette")
                    }, [
                        el('span', { className: 'google-symbols' }, ['keyboard_command_key'])
                    ]),
                    el('button', { id: 'sp-new-group-btn', className: 'sp-button sp-toolbar-action' }, [getMessage("ui_new_group")]),
                    el('button', { id: 'sp-manage-tags-btn', className: 'sp-button sp-toolbar-action' }, [getMessage("ui_manage_tags")]),
                    el('button', { id: 'sp-batch-action-btn', className: 'sp-button sp-toolbar-action' }, [getMessage("ui_batch_action")])
                ]),
                el('div', { className: 'sp-search-cluster' }, [
                    el('button', {
                        id: 'sp-search-btn',
                        className: 'sp-search-trigger sp-icon-button',
                        title: getMessage("ui_filter_sources"),
                        'aria-label': getMessage("ui_filter_sources")
                    }, [
                        el('span', { className: 'google-symbols' }, ['search'])
                    ]),
                    el('div', { className: 'sp-search-container' }, [
                        el('input', {
                            id: 'sp-search',
                            type: 'search',
                            placeholder: getMessage("ui_filter_sources_v2"),
                            'aria-label': getMessage("ui_filter_sources"),
                            autocomplete: 'off'
                        }),
                        el('span', {
                            id: 'sp-search-count',
                            className: 'sp-search-count',
                            hidden: true
                        })
                    ]),
                    el('button', {
                        id: 'sp-search-close-btn',
                        className: 'sp-search-close sp-icon-button',
                        title: getMessage("ui_cancel"),
                        'aria-label': getMessage("ui_cancel"),
                        'aria-hidden': 'true',
                        tabIndex: -1
                    }, [
                        el('span', { className: 'google-symbols' }, ['close'])
                    ])
                ])
            ]),
            el('div', { id: 'sp-quick-view-rail', className: 'sp-quick-view-rail' }),
            el('div', { id: 'sp-view-state', className: 'sp-view-state', hidden: true }),
            el('div', { id: 'sources-list' }),
            el('div', { className: 'sp-resizer' })
        ]);
    }

    globalThis.NSM_CREATE_MANAGER_SHELL = createManagerShell;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createManagerShell;
    }
})();
