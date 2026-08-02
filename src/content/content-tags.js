(function () {
    'use strict';

    /**
     * createContentTags(deps) — tag(标签)子系统的 CRUD + 颜色 + 排序 + source→tag 映射。
     * 直接读写 runtime.tagsById / runtime.sourceTagsById / runtime.state.tagOrder /
     * runtime.state.activeTagId — 是 state 的 thin wrapper,不持久化(saveState 在 caller)。
     *
     * @param {Object} deps runtime (持 tagsById / sourceTagsById / state)。
     *   读取 globalThis.NSM_CONTENT_CONFIG.TAG_COLOR_PRESETS + TAG_COLOR_HEX_PATTERN。
     * @returns {Object} 19 helpers,分三组:
     *   - 标签值归一化 + 颜色: normalizeTagLabel / normalizeTagColor / normalizeTagColorInputValue /
     *     getDefaultTagColor / getTagColorPresets / getTagColorRgb / getTagColorRgba /
     *     getTagStyleVars / getTagColorPreviewStyle / getSerializedTag
     *   - 查询: generateTagId / getSortedTagIds / getSourceTagIds / getTagUsageCounts / findExistingTagIdByLabel
     *   - CUD: createTag / updateTag / setSourceTagIds / deleteTag(会清理 sourceTagsById + activeTagId)
     */
    function createContentTags(deps = {}) {
        const runtime = deps.runtime || deps;
        const contentConfig = globalThis.NSM_CONTENT_CONFIG || {};

        const TAG_COLOR_PRESETS = Array.isArray(contentConfig.TAG_COLOR_PRESETS)
            ? contentConfig.TAG_COLOR_PRESETS
            : ['#007AFF'];
        const TAG_COLOR_HEX_PATTERN = contentConfig.TAG_COLOR_HEX_PATTERN instanceof RegExp
            ? contentConfig.TAG_COLOR_HEX_PATTERN
            : /^#([0-9A-F]{6})$/;
        const emitOnboardingSuccess = typeof deps.emitOnboardingSuccess === 'function'
            ? deps.emitOnboardingSuccess
            : (step) => {
                const EventCtor = deps.CustomEvent || globalThis.CustomEvent;
                if (
                    typeof globalThis.dispatchEvent !== 'function'
                    || typeof EventCtor !== 'function'
                ) {
                    return false;
                }
                globalThis.dispatchEvent(new EventCtor('nsm:onboarding-success', {
                    detail: { step }
                }));
                return true;
            };
        const invalidateSourceContextIndex = typeof deps.invalidateSourceContextIndex === 'function'
            ? deps.invalidateSourceContextIndex
            : () => {};

        function normalizeTagLabel(value) {
            return String(value || '')
                .trim()
                .replace(/\s+/g, ' ')
                .slice(0, 48);
        }

        function normalizeTagColor(value) {
            const rawValue = String(value || '').trim().toUpperCase();
            if (!rawValue) return null;

            const normalizedValue = rawValue.startsWith('#') ? rawValue : `#${rawValue}`;
            const match = normalizedValue.match(TAG_COLOR_HEX_PATTERN);
            return match ? `#${match[1]}` : null;
        }

        function getDefaultTagColor() {
            return TAG_COLOR_PRESETS[0];
        }

        function getTagColorPresets() {
            return [...TAG_COLOR_PRESETS];
        }

        function normalizeTagColorInputValue(value) {
            const compactValue = String(value || '')
                .trim()
                .toUpperCase()
                .replace(/[^#0-9A-F]/g, '');
            if (!compactValue) return '';

            const withoutPrefix = compactValue.startsWith('#') ? compactValue.slice(1) : compactValue;
            return `#${withoutPrefix.slice(0, 6)}`;
        }

        function getSerializedTag(tag) {
            if (!tag) return null;

            const serializedTag = {
                id: tag.id,
                label: normalizeTagLabel(tag.label)
            };
            const normalizedColor = normalizeTagColor(tag.color);
            if (normalizedColor) {
                serializedTag.color = normalizedColor;
            }
            return serializedTag;
        }

        function getTagColorRgb(color) {
            const normalizedColor = normalizeTagColor(color);
            if (!normalizedColor) return null;

            return {
                r: parseInt(normalizedColor.slice(1, 3), 16),
                g: parseInt(normalizedColor.slice(3, 5), 16),
                b: parseInt(normalizedColor.slice(5, 7), 16)
            };
        }

        function getTagColorRgba(color, alpha) {
            const rgb = getTagColorRgb(color);
            if (!rgb) return '';
            return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
        }

        function getTagStyleVars(tag, isActive = false) {
            const normalizedColor = normalizeTagColor(tag && tag.color);
            if (!normalizedColor) return '';

            return [
                '--sp-tag-text:#1A1A1C',
                '--sp-tag-dark-text:#F5F5F7',
                `--sp-tag-border:${getTagColorRgba(normalizedColor, isActive ? 0.38 : 0.22)}`,
                `--sp-tag-bg:${getTagColorRgba(normalizedColor, isActive ? 0.18 : 0.1)}`,
                '--sp-tag-hover-text:#1A1A1C',
                '--sp-tag-dark-hover-text:#F5F5F7',
                `--sp-tag-hover-border:${getTagColorRgba(normalizedColor, isActive ? 0.42 : 0.32)}`,
                `--sp-tag-hover-bg:${getTagColorRgba(normalizedColor, isActive ? 0.22 : 0.16)}`,
                '--sp-tag-active-text:#1A1A1C',
                '--sp-tag-dark-active-text:#F5F5F7',
                `--sp-tag-active-border:${getTagColorRgba(normalizedColor, 0.42)}`,
                `--sp-tag-active-bg:${getTagColorRgba(normalizedColor, 0.2)}`
            ].join(';');
        }

        function getTagColorPreviewStyle(color) {
            const normalizedColor = normalizeTagColor(color);
            if (!normalizedColor) return '';

            return [
                `background:${normalizedColor}`,
                `border-color:${getTagColorRgba(normalizedColor, 0.28)}`
            ].join(';');
        }

        function generateTagId() {
            return `tag_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        }

        function getSortedTagIds(tagIds = []) {
            if (!Array.isArray(tagIds) || tagIds.length === 0) return [];
            const orderIndex = new Map();
            const tagOrder = Array.isArray(runtime.state?.tagOrder) ? runtime.state.tagOrder : [];
            tagOrder.forEach((tagId, index) => orderIndex.set(tagId, index));
            return Array.from(new Set(tagIds))
                .filter((tagId) => runtime.tagsById.has(tagId))
                .sort((left, right) => (orderIndex.get(left) ?? Number.MAX_SAFE_INTEGER) - (orderIndex.get(right) ?? Number.MAX_SAFE_INTEGER));
        }

        function getSourceTagIds(sourceKey) {
            const tagIds = runtime.sourceTagsById.get(sourceKey);
            return Array.isArray(tagIds) && tagIds.length > 0
                ? getSortedTagIds(tagIds)
                : [];
        }

        function getTagUsageCounts() {
            const counts = new Map();
            runtime.sourceTagsById.forEach((tagIds) => {
                getSortedTagIds(tagIds).forEach((tagId) => {
                    counts.set(tagId, (counts.get(tagId) || 0) + 1);
                });
            });
            return counts;
        }

        function findExistingTagIdByLabel(label) {
            const normalizedLabel = normalizeTagLabel(label).toLowerCase();
            if (!normalizedLabel) return null;

            for (const [tagId, tag] of runtime.tagsById.entries()) {
                if (normalizeTagLabel(tag.label).toLowerCase() === normalizedLabel) {
                    return tagId;
                }
            }

            return null;
        }

        function createTagMutationResult(ok, reason, tagId = null, existingTagId = null) {
            return {
                ok: Boolean(ok),
                reason,
                tagId,
                existingTagId
            };
        }

        function createTag(label, options = {}) {
            const normalizedOptions = typeof options === 'string' ? { color: options } : options;
            const normalizedLabel = normalizeTagLabel(label);
            if (!normalizedLabel) {
                return createTagMutationResult(false, 'name_required');
            }

            const duplicateTagId = findExistingTagIdByLabel(normalizedLabel);
            if (duplicateTagId) {
                return createTagMutationResult(false, 'duplicate', null, duplicateTagId);
            }

            const tagId = generateTagId();
            runtime.tagsById.set(tagId, {
                id: tagId,
                label: normalizedLabel,
                color: normalizeTagColor(normalizedOptions && normalizedOptions.color)
            });
            runtime.state.tagOrder = Array.isArray(runtime.state.tagOrder) ? runtime.state.tagOrder : [];
            runtime.state.tagOrder.push(tagId);
            emitOnboardingSuccess('add-tag');
            return createTagMutationResult(true, 'created', tagId);
        }

        function updateTag(tagId, updates = {}) {
            const tag = runtime.tagsById.get(tagId);
            if (!tag) {
                return createTagMutationResult(false, 'not_found');
            }

            const normalizedLabel = normalizeTagLabel(updates.label !== undefined ? updates.label : tag.label);
            if (!normalizedLabel) {
                return createTagMutationResult(false, 'name_required');
            }

            const duplicateTagId = findExistingTagIdByLabel(normalizedLabel);
            if (duplicateTagId && duplicateTagId !== tagId) {
                return createTagMutationResult(false, 'duplicate', null, duplicateTagId);
            }

            const labelChanged = tag.label !== normalizedLabel;
            tag.label = normalizedLabel;
            if (Object.prototype.hasOwnProperty.call(updates, 'color')) {
                tag.color = normalizeTagColor(updates.color);
            }
            if (labelChanged) {
                invalidateSourceContextIndex();
            }
            return createTagMutationResult(true, 'updated', tagId);
        }

        function setSourceTagIds(sourceKey, tagIds) {
            const normalizedIds = getSortedTagIds(tagIds);
            const storedIds = runtime.sourceTagsById.get(sourceKey);
            const previousIds = Array.isArray(storedIds) ? storedIds : [];
            const searchablePreviousIds = getSortedTagIds(previousIds);
            const storageChanged = (
                previousIds.length !== normalizedIds.length
                || previousIds.some((tagId, index) => tagId !== normalizedIds[index])
            );
            if (!storageChanged) return;
            const searchContextChanged = (
                searchablePreviousIds.length !== normalizedIds.length
                || searchablePreviousIds.some((tagId, index) => tagId !== normalizedIds[index])
            );
            if (normalizedIds.length === 0) {
                runtime.sourceTagsById.delete(sourceKey);
                if (searchContextChanged) invalidateSourceContextIndex();
                return;
            }
            runtime.sourceTagsById.set(sourceKey, normalizedIds);
            if (searchContextChanged) invalidateSourceContextIndex();
        }

        function deleteTag(tagId) {
            if (!runtime.tagsById.has(tagId)) return;

            runtime.tagsById.delete(tagId);
            runtime.state.tagOrder = runtime.state.tagOrder.filter((id) => id !== tagId);
            if (runtime.state.activeTagId === tagId) {
                runtime.state.activeTagId = null;
            }

            let sourceAssignmentsChanged = false;
            runtime.sourceTagsById.forEach((tagIds, sourceKey) => {
                const nextTagIds = tagIds.filter((id) => id !== tagId);
                if (nextTagIds.length === tagIds.length) return;
                sourceAssignmentsChanged = true;
                if (nextTagIds.length === 0) {
                    runtime.sourceTagsById.delete(sourceKey);
                } else {
                    runtime.sourceTagsById.set(sourceKey, getSortedTagIds(nextTagIds));
                }
            });
            if (sourceAssignmentsChanged) {
                invalidateSourceContextIndex();
            }
        }

        return {
            normalizeTagLabel,
            normalizeTagColor,
            getDefaultTagColor,
            getTagColorPresets,
            normalizeTagColorInputValue,
            getSerializedTag,
            getTagColorRgb,
            getTagColorRgba,
            getTagStyleVars,
            getTagColorPreviewStyle,
            generateTagId,
            getSortedTagIds,
            getSourceTagIds,
            getTagUsageCounts,
            findExistingTagIdByLabel,
            createTagMutationResult,
            createTag,
            updateTag,
            setSourceTagIds,
            deleteTag
        };
    }

    globalThis.NSM_CREATE_CONTENT_TAGS = createContentTags;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentTags;
    }
})();
