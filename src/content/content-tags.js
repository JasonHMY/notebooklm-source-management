(function () {
    'use strict';

    function createContentTags(deps = {}) {
        const {
            showToast,
            getMessage
        } = deps;
        const runtime = deps.runtime || deps;

        const TAG_COLOR_PRESETS = [
            '#007AFF',
            '#34C759',
            '#FF9500',
            '#FF3B30',
            '#AF52DE',
            '#5AC8FA',
            '#FF2D55',
            '#8E8E93'
        ];
        const TAG_COLOR_HEX_PATTERN = /^#([0-9A-F]{6})$/;

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
                `--sp-tag-text:${normalizedColor}`,
                `--sp-tag-border:${getTagColorRgba(normalizedColor, isActive ? 0.38 : 0.22)}`,
                `--sp-tag-bg:${getTagColorRgba(normalizedColor, isActive ? 0.18 : 0.1)}`,
                `--sp-tag-hover-text:${normalizedColor}`,
                `--sp-tag-hover-border:${getTagColorRgba(normalizedColor, isActive ? 0.42 : 0.32)}`,
                `--sp-tag-hover-bg:${getTagColorRgba(normalizedColor, isActive ? 0.22 : 0.16)}`,
                `--sp-tag-active-text:${normalizedColor}`,
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
            const orderIndex = new Map();
            runtime.state.tagOrder.forEach((tagId, index) => orderIndex.set(tagId, index));
            return Array.from(new Set(tagIds))
                .filter((tagId) => runtime.tagsById.has(tagId))
                .sort((left, right) => (orderIndex.get(left) ?? Number.MAX_SAFE_INTEGER) - (orderIndex.get(right) ?? Number.MAX_SAFE_INTEGER));
        }

        function getSourceTagIds(sourceKey) {
            return getSortedTagIds(runtime.sourceTagsById.get(sourceKey) || []);
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

        function createTag(label, options = {}) {
            const normalizedOptions = typeof options === 'string' ? { color: options } : options;
            const normalizedLabel = normalizeTagLabel(label);
            if (!normalizedLabel) {
                showToast(getMessage('ui_tag_name_required'));
                return null;
            }

            const duplicateTagId = findExistingTagIdByLabel(normalizedLabel);
            if (duplicateTagId) {
                showToast(getMessage('ui_tag_create_duplicate'));
                return duplicateTagId;
            }

            const tagId = generateTagId();
            runtime.tagsById.set(tagId, {
                id: tagId,
                label: normalizedLabel,
                color: normalizeTagColor(normalizedOptions && normalizedOptions.color)
            });
            runtime.state.tagOrder.push(tagId);
            return tagId;
        }

        function updateTag(tagId, updates = {}) {
            const tag = runtime.tagsById.get(tagId);
            if (!tag) return null;

            const normalizedLabel = normalizeTagLabel(updates.label !== undefined ? updates.label : tag.label);
            if (!normalizedLabel) {
                showToast(getMessage('ui_tag_name_required'));
                return null;
            }

            const duplicateTagId = findExistingTagIdByLabel(normalizedLabel);
            if (duplicateTagId && duplicateTagId !== tagId) {
                showToast(getMessage('ui_tag_create_duplicate'));
                return duplicateTagId;
            }

            tag.label = normalizedLabel;
            tag.color = normalizeTagColor(updates.color);
            return tagId;
        }

        function setSourceTagIds(sourceKey, tagIds) {
            const normalizedIds = getSortedTagIds(tagIds);
            if (normalizedIds.length === 0) {
                runtime.sourceTagsById.delete(sourceKey);
                return;
            }
            runtime.sourceTagsById.set(sourceKey, normalizedIds);
        }

        function deleteTag(tagId) {
            if (!runtime.tagsById.has(tagId)) return;

            runtime.tagsById.delete(tagId);
            runtime.state.tagOrder = runtime.state.tagOrder.filter((id) => id !== tagId);
            if (runtime.state.activeTagId === tagId) {
                runtime.state.activeTagId = null;
            }

            runtime.sourceTagsById.forEach((tagIds, sourceKey) => {
                const nextTagIds = tagIds.filter((id) => id !== tagId);
                setSourceTagIds(sourceKey, nextTagIds);
            });
        }

        return {
            normalizeTagLabel,
            normalizeTagColor,
            getDefaultTagColor,
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
