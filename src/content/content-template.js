(function () {
    'use strict';

    /**
     * createManagerShell(el, chromeOrGetMessage) — Shadow DOM manager 的静态外壳 DOM 工厂。
     * 注意:这是签名最特殊的 factory —— 不接 deps object,直接返回组装好的根节点(<div.sp-container>),
     * 不返回 { method } map。内部 toolbar / search cluster / quick-view rail / view-state /
     * sources-list / resizer 五个 anchor 是固定的;后续 content-render 通过 ID 查找填内容。
     *
     * @param {Function} el — XSS-safe element factory(src/utils/index.js)。
     * @param {Function|Object} chromeOrGetMessage — 若是函数视作 getMessage(key);若是对象走 chrome.i18n.getMessage 回退。
     * @returns {HTMLElement} <div.sp-container> 根节点(尚未插入 Shadow DOM)。
     */
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
                            'aria-live': 'polite',
                            'aria-atomic': 'true',
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
            el('div', { id: 'sp-quick-view-rail', className: 'sp-quick-view-rail', role: 'group', 'aria-label': getMessage('ui_quick_view_rail_label') }),
            el('div', { id: 'sp-view-state', className: 'sp-view-state', hidden: true }),
            el('div', { id: 'sources-list' }),
            el('div', {
                id: 'sp-tree-order-status',
                className: 'sp-sr-only',
                role: 'status',
                'aria-live': 'polite',
                'aria-atomic': 'true'
            }),
            el('div', {
                className: 'sp-resizer',
                role: 'separator',
                'aria-orientation': 'horizontal',
                'aria-label': getMessage('ui_panel_resizer_label'),
                tabIndex: 0
            })
        ]);
    }

    globalThis.NSM_CREATE_MANAGER_SHELL = createManagerShell;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createManagerShell;
    }
})();
