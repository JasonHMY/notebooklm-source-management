(function () {
    'use strict';

    /**
     * createContentSourceViewSwitchController(deps) — NotebookLM "list view ↔ label view"
     * 切换的状态机辅助层。把"检测到的原生 view 类型 (kind / confidence / unknown)"
     * 与"用户期望显示的 view 类型 (displayKind)"两套坐标对齐,生成可记录的 status 字段
     * 与 attempt 时间戳,供 content-source-sync 决策是否真的去切。
     *
     * @param {Object} deps Optional: SOURCE_VIEW_LIST ('list'), SOURCE_VIEW_LABEL ('label') 常量。
     * @returns {Object} 7 helpers:normalizeSourceViewSwitchTarget / isConcreteSourceViewKind /
     *   getFallbackSourceViewDisplayKind / buildSourceDisplayViewInfo /
     *   buildSourceViewStatusFields / createLastViewSwitchAttempt / finishViewSwitchAttempt。
     *   后两个支持注入 nowMs / now ISO 函数以便测试。
     */
    function createContentSourceViewSwitchController(deps = {}) {
        const SOURCE_VIEW_LIST = deps.SOURCE_VIEW_LIST || 'list';
        const SOURCE_VIEW_LABEL = deps.SOURCE_VIEW_LABEL || 'label';

        function normalizeSourceViewSwitchTarget(viewKind) {
            return viewKind === SOURCE_VIEW_LABEL ? SOURCE_VIEW_LABEL : SOURCE_VIEW_LIST;
        }

        function isConcreteSourceViewKind(value) {
            return value === SOURCE_VIEW_LIST || value === SOURCE_VIEW_LABEL;
        }

        function getFallbackSourceViewDisplayKind(info, currentDisplayKind) {
            if (isConcreteSourceViewKind(info?.kind)) return info.kind;
            return normalizeSourceViewSwitchTarget(currentDisplayKind);
        }

        function buildSourceDisplayViewInfo(nativeInfo = {}, displayKind = SOURCE_VIEW_LIST) {
            const normalizedDisplayKind = normalizeSourceViewSwitchTarget(displayKind);
            return Object.assign({}, nativeInfo || {}, {
                kind: normalizedDisplayKind,
                displayKind: normalizedDisplayKind,
                detectedKind: nativeInfo?.kind || 'unknown',
                detectedConfidence: Number(nativeInfo?.confidence) || 0,
                displayOverride: normalizedDisplayKind !== (nativeInfo?.kind || 'unknown')
            });
        }

        function buildSourceViewStatusFields(nativeInfo = {}, displayInfo = {}) {
            return {
                sourceViewKind: displayInfo.kind || SOURCE_VIEW_LIST,
                sourceViewDisplayKind: displayInfo.displayKind || SOURCE_VIEW_LIST,
                detectedSourceViewKind: displayInfo.detectedKind || nativeInfo?.kind || 'unknown',
                sourceViewConfidence: Number(nativeInfo?.confidence) || 0
            };
        }

        function createLastViewSwitchAttempt(details = {}, now = () => new Date().toISOString()) {
            return Object.assign({ attemptedAt: now() }, details || {});
        }

        function finishViewSwitchAttempt(previousAttempt = {}, result = {}, startedAtMs = Date.now(), nowMs = () => Date.now(), now = () => new Date().toISOString()) {
            return Object.assign({}, previousAttempt || {}, {
                success: Boolean(result?.success),
                reason: result?.reason || '',
                targetViewKind: result?.viewKind || '',
                detectedSourceViewKind: result?.detectedSourceViewKind || result?.confirmedSourceViewKind || 'unknown',
                sourceViewDisplayKind: result?.sourceViewDisplayKind || SOURCE_VIEW_LIST,
                displayOverride: Boolean(result?.displayOverride),
                completedAt: now(),
                durationMs: Math.max(0, nowMs() - startedAtMs)
            });
        }

        return {
            normalizeSourceViewSwitchTarget,
            isConcreteSourceViewKind,
            getFallbackSourceViewDisplayKind,
            buildSourceDisplayViewInfo,
            buildSourceViewStatusFields,
            createLastViewSwitchAttempt,
            finishViewSwitchAttempt
        };
    }

    globalThis.NSM_CREATE_CONTENT_SOURCE_VIEW_SWITCH_CONTROLLER = createContentSourceViewSwitchController;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentSourceViewSwitchController;
    }
})();
