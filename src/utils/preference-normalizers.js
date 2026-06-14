/**
 * src/utils/preference-normalizers.js — 偏好归一化工具集,在 background SW 与
 * content script 两个运行时共享。
 *
 * 设计目的:
 *   消除 background/index.js 与 content/content-developer-logger.js 之间逐字重复的
 *   10 个 normalize* 函数(~130 行)。两端任何 normalize 规则变化(新增语言、改
 *   shortcut 别名、扩展 quick view kinds 等)只在此文件维护一份。
 *
 * 加载方式:
 *   - Content script: 通过 manifest.json content_scripts 在 src/utils/index.js 之后
 *     立即加载(必须早于 content-developer-logger.js)。IIFE 执行后挂在
 *     globalThis.NSM_PREFERENCE_NORMALIZERS。
 *   - Background SW: 在 src/background/index.js 顶部用 importScripts 加载;test
 *     环境(Node)走 module.exports 同样初始化 globalThis。
 *
 * 自包含:不依赖外部常量。`QUICK_VIEW_BUTTON_KINDS` / `HISTORY_RETENTION_LIMIT_OPTIONS`
 * / `STATE_HISTORY_LIMIT` 在本文件内定义,与 background/index.js 顶部声明的同名
 * 常量保持值相同(语义契约);若未来扩展 quick view 或 history 选项,两处必须同步。
 *
 * 测试: tests/background.test.js 与 tests/content/content-developer-logger.test.js
 * 覆盖所有 normalize* 行为;改本文件即可影响两侧测试。
 */

(function () {
    'use strict';

    const QUICK_VIEW_BUTTON_KINDS = ['all', 'ungrouped', 'disabled', 'tag', 'recent', 'issues'];
    const HISTORY_RETENTION_LIMIT_OPTIONS = [20, 50, 100];
    const STATE_HISTORY_LIMIT = 20;

    function normalizePreferenceVersion(value) {
        const version = Number(value);
        if (!Number.isFinite(version) || version < 0) return 0;
        return Math.floor(version);
    }

    function normalizeWhatsNewSeenVersion(value) {
        if (value == null) return '';
        const text = String(value).trim();
        if (!text) return '';
        if (!/^\d+(?:\.\d+){0,3}$/.test(text)) return '';
        return text.split('.')
            .map((part) => String(Number(part)))
            .join('.');
    }

    function normalizeHistoryRetentionLimit(value) {
        const limit = Number(value);
        return HISTORY_RETENTION_LIMIT_OPTIONS.includes(limit) ? limit : STATE_HISTORY_LIMIT;
    }

    function normalizeLanguageOverride(value) {
        const normalized = String(value || 'auto').trim();
        return normalized === 'auto' || normalized === 'en' || normalized === 'es' || normalized === 'zh_CN'
            ? normalized
            : 'auto';
    }

    function normalizeDragMode(value) {
        return value === 'reflow' ? 'reflow' : 'classic';
    }

    function normalizeCommandShortcutId(value) {
        const id = String(value || '').trim();
        return /^[a-z0-9][a-z0-9-]{0,79}$/.test(id) ? id : '';
    }

    function normalizeCommandShortcutKey(value) {
        const key = String(value || '').trim();
        if (!key) return '';
        if (key === ' ') return 'Space';
        const aliases = {
            esc: 'Escape',
            escape: 'Escape',
            spacebar: 'Space',
            space: 'Space',
            return: 'Enter',
            enter: 'Enter',
            del: 'Delete',
            delete: 'Delete',
            backspace: 'Backspace',
            tab: 'Tab'
        };
        const lower = key.toLowerCase();
        if (aliases[lower]) return aliases[lower];
        if (/^f\d{1,2}$/i.test(key)) return key.toUpperCase();
        if (key.length === 1) return key.toUpperCase();
        return key.replace(/^\w/, (char) => char.toUpperCase()).slice(0, 32);
    }

    function normalizeCommandShortcutCombo(value) {
        const parts = String(value || '')
            .split('+')
            .map((part) => part.trim())
            .filter(Boolean);
        if (parts.length < 2) return '';

        const modifierAliases = new Map([
            ['cmd', 'Meta'],
            ['command', 'Meta'],
            ['meta', 'Meta'],
            ['ctrl', 'Ctrl'],
            ['control', 'Ctrl'],
            ['alt', 'Alt'],
            ['option', 'Alt'],
            ['shift', 'Shift']
        ]);
        const modifiers = new Set();
        let shortcutKey = '';

        parts.forEach((part, index) => {
            const alias = modifierAliases.get(part.toLowerCase());
            if (alias && index < parts.length - 1) {
                modifiers.add(alias);
                return;
            }
            shortcutKey = normalizeCommandShortcutKey(part);
        });

        if (!shortcutKey || modifiers.size === 0) return '';
        return ['Meta', 'Ctrl', 'Alt', 'Shift']
            .filter((modifier) => modifiers.has(modifier))
            .concat(shortcutKey)
            .join('+');
    }

    function normalizeCommandShortcuts(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
        return Object.entries(value).reduce((result, [rawId, rawCombo]) => {
            const id = normalizeCommandShortcutId(rawId);
            const combo = normalizeCommandShortcutCombo(rawCombo);
            if (!id || !combo) return result;
            Object.keys(result).forEach((existingId) => {
                if (result[existingId] === combo && existingId !== id) {
                    delete result[existingId];
                }
            });
            result[id] = combo;
            return result;
        }, {});
    }

    function normalizeVisibleQuickViewKinds(value) {
        if (!Array.isArray(value)) return [...QUICK_VIEW_BUTTON_KINDS];
        const requestedKinds = new Set(value.map((kind) => String(kind || '').trim().toLowerCase()));
        return QUICK_VIEW_BUTTON_KINDS.filter((kind) => requestedKinds.has(kind));
    }

    function normalizeAppearancePreferences(value) {
        const source = value && typeof value === 'object' ? value : {};
        return {
            hoverSpotlightEnabled: source.hoverSpotlightEnabled !== false
        };
    }

    globalThis.NSM_PREFERENCE_NORMALIZERS = {
        normalizePreferenceVersion,
        normalizeWhatsNewSeenVersion,
        normalizeHistoryRetentionLimit,
        normalizeLanguageOverride,
        normalizeDragMode,
        normalizeCommandShortcutId,
        normalizeCommandShortcutKey,
        normalizeCommandShortcutCombo,
        normalizeCommandShortcuts,
        normalizeVisibleQuickViewKinds,
        normalizeAppearancePreferences
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = globalThis.NSM_PREFERENCE_NORMALIZERS;
    }
}());
