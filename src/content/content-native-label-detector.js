(function () {
    'use strict';

    /**
     * createContentNativeLabelDetector(deps) — 识别 NotebookLM 原生标签视图 DOM 信号。
     * 用一组正则 + 文本启发式判断:某个 DOM 节点是不是"label 入口控件"、
     * "source-view 切换 (list/label)"、"clean accessible label 标题"等。
     *
     * @param {Object} deps Optional: getAttributeValue(el, attr) — 来自 panel-dom;
     *   getElementTextSignal(el) — 聚合 aria-label / title / alt / textContent。
     *   两者都有内置 fallback。
     * @returns {Object} 9 个 pattern 常量 + 9 个 helper:
     *   - `cleanAccessibleLabelTitle / collapseRepeatedNativeLabelTitle / cleanNativeLabelTitleCandidate`
     *     一组标题清洗 (去 "expand/collapse" 前缀、symbols ligature、source-count 后缀)
     *   - `getComparableLabelText / getComparableNativeLabelTitle` — 转 lowercase 用于等值比对
     *   - `isLikelyNativeLabelTitle / isNativeLabelEntryPointControl / isNativeSourceViewSwitchControl`
     *     三类布尔判定;入参既可以是字符串也可以是 element。
     */
    function createContentNativeLabelDetector(deps = {}) {
        const getAttributeValue = typeof deps.getAttributeValue === 'function'
            ? deps.getAttributeValue
            : (element, attr) => {
                if (!element || typeof element.getAttribute !== 'function') return '';
                return String(element.getAttribute(attr) || '').trim();
            };
        const getElementTextSignal = typeof deps.getElementTextSignal === 'function'
            ? deps.getElementTextSignal
            : (element) => {
                if (!element) return '';
                const parts = [];
                ['aria-label', 'title', 'alt'].forEach((attr) => {
                    const value = typeof element.getAttribute === 'function' ? element.getAttribute(attr) : null;
                    if (value) parts.push(value);
                });
                if (typeof element.textContent === 'string') {
                    parts.push(element.textContent);
                }
                return parts.join(' ').replace(/\s+/g, ' ').trim();
            };

        const ACTIVE_LABEL_VIEW_CONTROL_PATTERN = /\b(relabel|re-label|undo\s+labels?|redo\s+labels?|recategor(?:y|ies|ize))\b|撤销.*标签|重新.*标签|撤销.*分类|重新.*分类/i;
        const SOURCE_VIEW_SWITCH_TEXT_PATTERN = /\b(?:list\s*view|view\s*list|view_list|format_list_bulleted|label\s*view|labels?\s*view|view\s*by\s*label)\b|列表视图|标签视图/i;
        const SOURCE_VIEW_SWITCH_ID_PATTERN = /(?:source[-_\s]*view|view[-_\s]*(?:list|label)|list[-_\s]*view|label[-_\s]*view)/i;
        const SOURCE_VIEW_SWITCH_ICON_PATTERN = /\b(?:label_auto|view_list|format_list_bulleted)\b/i;
        const NATIVE_LABEL_ENTRY_POINT_TEXT_PATTERN = /\b(?:auto[-\s]*label|label\s+sources?\s+by\s+topic|categor(?:ize|ise)\s+sources?\s+by\s+topic|organize\s+sources?\s+by\s+topic)\b|按主题.*(?:来源)?(?:加|打)?标签|自动.*(?:来源)?(?:加|打)?标签/i;
        const SELECT_ALL_TEXT_PATTERN = /\bselect\s+all\b|全选/i;
        const NATIVE_SOURCE_CONTROL_TEXT_PATTERN = /\b(add\s+source|web|fast\s+research|submit)\b|language\s*web|languageWeb|fastResearch|添加来源|提交/i;
        const NATIVE_LABEL_TITLE_BLOCKED_TEXT_PATTERN = /\b(more\s+options?|source\s+guide|source\s+details?|loading|analyzing|failed|error|dock_to_(?:right|left|top|bottom)|left_panel_open|left_panel_close)\b|来源指南|来源详情|加载中|正在分析|失败|出错/i;
        const NATIVE_LABEL_TITLE_RESERVED_TEXT_PATTERN = /^(?:sources?|source|来源)$|\bsources?\s+for\b/i;

        function cleanAccessibleLabelTitle(value) {
            const text = String(value || '').replace(/\s+/g, ' ').trim();
            if (!text) return '';
            const cleaned = text
                .replace(/\s+(?:source\s+)?(?:label|labels|category|categories|group|groups)$/i, '')
                .replace(/\s*(?:标签|分類|分类|分组)\s*$/i, '')
                .replace(/\s+/g, ' ')
                .trim();
            return cleaned || text;
        }

        function collapseRepeatedNativeLabelTitle(value) {
            const text = String(value || '').replace(/\s+/g, ' ').trim();
            if (!text) return '';
            const tokens = text.split(/\s+/);
            if (tokens.length >= 2 && tokens.length % 2 === 0) {
                const midpoint = tokens.length / 2;
                const left = tokens.slice(0, midpoint).join(' ');
                const right = tokens.slice(midpoint).join(' ');
                if (left && left === right) return left;
            }
            return text;
        }

        function cleanNativeLabelTitleCandidate(value) {
            const text = cleanAccessibleLabelTitle(value)
                .replace(/^\s*(?:expand|collapse|open|close)\s+(?:source\s+)?(?:label|group|category|folder)\s*/i, ' ')
                .replace(/^\s*(?:展开|折叠|打开|关闭)\s*/i, ' ')
                .replace(/\s*(?:expanded|collapsed|已展开|已折叠)\s*$/i, ' ')
                .replace(/(?:keyboard_arrow_(?:right|down)|arrow_drop_down|expand_(?:more|less)|chevron_(?:right|left)|label_auto|more_(?:vert|horiz)|dock_to_(?:right|left|top|bottom)|left_panel_(?:open|close))/gi, ' ')
                .replace(/\b\d+\s*(?:sources?|items?)\b/gi, ' ')
                .replace(/\b\d+\s*(?:个)?(?:来源|项目)\b/gi, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            return collapseRepeatedNativeLabelTitle(text);
        }

        function getComparableLabelText(value) {
            return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
        }

        function getComparableNativeLabelTitle(value) {
            return getComparableLabelText(cleanNativeLabelTitleCandidate(value));
        }

        function isLikelyNativeLabelTitle(value, rowIdentity = null) {
            const title = cleanNativeLabelTitleCandidate(value);
            if (!title || title.length > 120) return false;
            if (NATIVE_LABEL_ENTRY_POINT_TEXT_PATTERN.test(String(value || ''))) return false;
            if (SELECT_ALL_TEXT_PATTERN.test(title)) return false;
            if (NATIVE_SOURCE_CONTROL_TEXT_PATTERN.test(title)) return false;
            if (ACTIVE_LABEL_VIEW_CONTROL_PATTERN.test(title)) return false;
            if (NATIVE_LABEL_TITLE_BLOCKED_TEXT_PATTERN.test(title)) return false;
            if (NATIVE_LABEL_TITLE_RESERVED_TEXT_PATTERN.test(title)) return false;
            if (rowIdentity?.title && getComparableLabelText(title) === getComparableLabelText(rowIdentity.title)) return false;
            return /[A-Za-z0-9\u3400-\u9FFF]/.test(title);
        }

        function isNativeLabelEntryPointControl(element) {
            if (!element) return false;
            return NATIVE_LABEL_ENTRY_POINT_TEXT_PATTERN.test(getElementTextSignal(element));
        }

        function isNativeSourceViewSwitchControl(element) {
            if (!element) return false;
            const tagName = String(element.tagName || '').toLowerCase();
            const role = getAttributeValue(element, 'role').toLowerCase();
            const ariaPressed = getAttributeValue(element, 'aria-pressed');
            const ariaSelected = getAttributeValue(element, 'aria-selected');
            const ariaChecked = getAttributeValue(element, 'aria-checked');
            const text = getElementTextSignal(element);
            const identityText = [
                getAttributeValue(element, 'data-testid'),
                getAttributeValue(element, 'class'),
                String(element.className || '')
            ].filter(Boolean).join(' ');
            const isInteractive = (
                tagName === 'button' ||
                ['button', 'tab', 'radio', 'switch', 'menuitemradio'].includes(role) ||
                Boolean(ariaPressed || ariaSelected || ariaChecked)
            );
            if (!isInteractive) return false;
            return (
                SOURCE_VIEW_SWITCH_TEXT_PATTERN.test(text) ||
                SOURCE_VIEW_SWITCH_ID_PATTERN.test(identityText) ||
                (Boolean(ariaPressed || ariaSelected || ariaChecked) && SOURCE_VIEW_SWITCH_ICON_PATTERN.test(text))
            );
        }

        return {
            ACTIVE_LABEL_VIEW_CONTROL_PATTERN,
            SOURCE_VIEW_SWITCH_TEXT_PATTERN,
            SOURCE_VIEW_SWITCH_ID_PATTERN,
            SOURCE_VIEW_SWITCH_ICON_PATTERN,
            NATIVE_LABEL_ENTRY_POINT_TEXT_PATTERN,
            SELECT_ALL_TEXT_PATTERN,
            NATIVE_SOURCE_CONTROL_TEXT_PATTERN,
            NATIVE_LABEL_TITLE_BLOCKED_TEXT_PATTERN,
            NATIVE_LABEL_TITLE_RESERVED_TEXT_PATTERN,
            cleanAccessibleLabelTitle,
            collapseRepeatedNativeLabelTitle,
            cleanNativeLabelTitleCandidate,
            getComparableLabelText,
            getComparableNativeLabelTitle,
            isLikelyNativeLabelTitle,
            isNativeLabelEntryPointControl,
            isNativeSourceViewSwitchControl
        };
    }

    globalThis.NSM_CREATE_CONTENT_NATIVE_LABEL_DETECTOR = createContentNativeLabelDetector;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentNativeLabelDetector;
    }
})();
