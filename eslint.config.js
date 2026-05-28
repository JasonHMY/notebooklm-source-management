const globals = require('globals');

const NSM_FACTORY_GLOBALS = {
    NSM_CONTENT_CONFIG: 'readonly',
    NSM_SOURCE_DESCRIPTOR_HELPERS: 'readonly',
    NSM_CONTENT_STYLE_TEXT: 'readonly',
    NSM_GLOBAL_OVERLAY_STYLE_TEXT: 'readonly',
    NSM_CREATE_MANAGER_SHELL: 'readonly',
    NSM_CREATE_CONTENT_PANEL_DOM: 'readonly',
    NSM_CREATE_CONTENT_SOURCE_ACTION_MENU: 'readonly',
    NSM_CREATE_CONTENT_SOURCE_ACTIONS: 'readonly',
    NSM_CREATE_CONTENT_TAGS: 'readonly',
    NSM_CREATE_CONTENT_STATE_RECONCILE: 'readonly',
    NSM_CREATE_CONTENT_DEVELOPER_LOGGER: 'readonly',
    NSM_CREATE_CONTENT_RUNTIME_STATE: 'readonly',
    NSM_CREATE_CONTENT_MESSAGE_ROUTER: 'readonly',
    NSM_CREATE_CONTENT_TOAST_STATUS: 'readonly',
    NSM_CREATE_CONTENT_TOAST: 'readonly',
    NSM_CREATE_CONTENT_STATE_APPLY: 'readonly',
    NSM_CREATE_CONTENT_UNDO_HISTORY: 'readonly',
    NSM_CREATE_CONTENT_IMPORT_EXPORT: 'readonly',
    NSM_CREATE_CONTENT_DIAGNOSTICS: 'readonly',
    NSM_CREATE_CONTENT_SOURCE_VIEW_SWITCH_CONTROLLER: 'readonly',
    NSM_CREATE_CONTENT_SNAPSHOT_SIGNATURE: 'readonly',
    NSM_CREATE_CONTENT_STATE_REPAIR: 'readonly',
    NSM_CREATE_CONTENT_PERSISTENCE: 'readonly',
    NSM_CREATE_CONTENT_SOURCE_LIST_SCAN: 'readonly',
    NSM_CREATE_CONTENT_NATIVE_LABEL_SCAN: 'readonly',
    NSM_CREATE_CONTENT_NATIVE_LABEL_IMPORT: 'readonly',
    NSM_CREATE_CONTENT_NATIVE_LABEL_IMPORT_CONTROLLER: 'readonly',
    NSM_CREATE_CONTENT_NATIVE_LABEL_IMPORT_MODAL: 'readonly',
    NSM_CREATE_CONTENT_SOURCE_PARTIAL_SYNC_GUARD: 'readonly',
    NSM_CREATE_CONTENT_MODAL_FOCUS: 'readonly',
    NSM_CREATE_CONTENT_MODAL_WELCOME: 'readonly',
    NSM_CREATE_CONTENT_MODAL_WHATS_NEW: 'readonly',
    NSM_CREATE_CONTENT_MODAL_TAG_FILTER: 'readonly',
    NSM_CREATE_CONTENT_MODAL_MOVE: 'readonly',
    NSM_CREATE_CONTENT_MODAL_COMMAND_PALETTE: 'readonly',
    NSM_CREATE_CONTENT_MODAL_TAG: 'readonly',
    NSM_CREATE_CONTENT_MODAL_SETTINGS: 'readonly',
    NSM_CREATE_CONTENT_MODALS: 'readonly',
    NSM_CREATE_CONTENT_RENDER: 'readonly',
    NSM_CREATE_CONTENT_VIEW_STATE: 'readonly',
    NSM_CREATE_CONTENT_NATIVE_CHECKBOX_SYNC: 'readonly',
    NSM_CREATE_CONTENT_TREE_INTERACTIONS: 'readonly',
    NSM_CREATE_CONTENT_NATIVE_LABEL_DETECTOR: 'readonly',
    NSM_CREATE_CONTENT_SOURCE_SYNC: 'readonly'
};

const COMMON_RULES = {
    'no-undef': 'error',
    'no-unused-vars': ['warn', {
        args: 'none',
        varsIgnorePattern: '^_',
        caughtErrors: 'none'
    }],
    'no-useless-escape': 'warn',
    'no-restricted-syntax': ['error', {
        selector: 'AssignmentExpression[left.property.name="innerHTML"]',
        message: 'Do not assign to innerHTML; use el() helper or textContent (AGENTS.md).'
    }]
};

module.exports = [
    {
        ignores: [
            'node_modules/**',
            'release/**',
            'output/**',
            'marketing/x-publisher/**',
            '.agent/**',
            '.agents/**',
            '.cursor/**',
            '.codegraph/**',
            '.superpowers/**'
        ]
    },
    {
        files: ['src/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'script',
            globals: {
                ...globals.browser,
                ...globals.webextensions,
                ...NSM_FACTORY_GLOBALS,
                module: 'readonly',
                require: 'readonly',
                exports: 'readonly',
                importScripts: 'readonly',
                NSM_PREFERENCE_NORMALIZERS: 'readonly',
                structuredClone: 'readonly',
                TextEncoder: 'readonly',
                TextDecoder: 'readonly',
                Element: 'readonly',
                HTMLElement: 'readonly',
                Node: 'readonly',
                el: 'readonly',
                debounce: 'readonly',
                isDescendant: 'readonly',
                getMessage: 'readonly',
                getChromeApi: 'readonly',
                getUiLanguage: 'readonly',
                getEffectiveMessageLocale: 'readonly',
                normalizeHtmlLanguage: 'readonly',
                setMessageLocaleOverride: 'readonly',
                getMessageLocaleOverride: 'readonly',
                loadLocaleMessages: 'readonly'
            }
        },
        rules: COMMON_RULES
    },
    {
        files: ['tests/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: {
                ...globals.node,
                ...globals.jest,
                ...globals.browser,
                ...NSM_FACTORY_GLOBALS,
                structuredClone: 'readonly',
                TextEncoder: 'readonly'
            }
        },
        rules: {
            ...COMMON_RULES,
            'no-unused-vars': 'off'
        }
    },
    {
        files: ['tests/smoke/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: {
                ...globals.node,
                ...globals.browser,
                chrome: 'readonly',
                browser: 'readonly'
            }
        },
        rules: {
            ...COMMON_RULES,
            'no-unused-vars': 'off',
            'no-restricted-syntax': 'off'
        }
    },
    {
        files: ['scripts/**/*.js', '*.config.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: {
                ...globals.node
            }
        },
        rules: COMMON_RULES
    }
];
