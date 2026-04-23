(function () {
    'use strict';

    const DEPS = {
        panel: ['[data-testid="source-panel"]', '.source-panel'],
        scroll: ['.scroll-area'],
        row: ['[data-testid="source-item"]', '.single-source-container'],
        title: ['[data-testid="source-title"]', '.source-title'],
        checkbox: ['input[type="checkbox"]', '.select-checkbox input[type="checkbox"]'],
        moreBtn: ['[aria-label="More options"]', '.source-item-more-button'],
        icon: ['mat-icon[class*="-icon-color"]', 'mat-icon:not([aria-label="More options"] mat-icon):not(button mat-icon)'],
        iconImage: [
            'img',
            '[style*="background-image"]',
            '[style*="background:"]',
            '[style*="mask-image"]',
            '[style*="webkit-mask-image"]'
        ]
    };

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

    const contentConfig = {
        DEPS,
        TAG_COLOR_PRESETS,
        TAG_COLOR_HEX_PATTERN,
        SCROLL_AREA_SELECTOR: DEPS.scroll[0],
        SOURCE_TITLE_SELECTOR: DEPS.title[0],
        SOURCE_CHECKBOX_SELECTOR: DEPS.checkbox[0],
        SOURCE_ICON_SELECTOR: DEPS.icon[0],
        STORAGE_SCHEMA_VERSION: 3,
        IMPORT_CONFIG_MAX_FILE_BYTES: 2 * 1024 * 1024,
        IMPORT_CONFIG_MAX_GROUPS: 1000,
        IMPORT_CONFIG_MAX_TAGS: 500,
        IMPORT_CONFIG_MAX_SOURCES: 5000,
        IMPORT_CONFIG_MAX_CHILD_REFS: 10000,
        IMPORT_CONFIG_MAX_TREE_DEPTH: 50,
        GLOBAL_OVERLAY_STYLE_ID: 'sp-global-glassmorphism',
        ROUTE_REINIT_MAX_ATTEMPTS: 4,
        ROUTE_REINIT_RETRY_DELAY_MS: 400
    };

    globalThis.NSM_CONTENT_CONFIG = contentConfig;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = contentConfig;
    }
})();
