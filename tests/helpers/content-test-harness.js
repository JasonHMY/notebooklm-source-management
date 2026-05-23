global.Node = class {};
const loadContentModule = require('./load-content-module');
const nativeSetTimeout = global.setTimeout;
const nativeClearTimeout = global.clearTimeout;

const CONTENT_HELPER_GLOBALS = [
    'NSM_CONTENT_CONFIG',
    'NSM_SOURCE_DESCRIPTOR_HELPERS',
    'NSM_CONTENT_STYLE_TEXT',
    'NSM_GLOBAL_OVERLAY_STYLE_TEXT',
    'NSM_CREATE_MANAGER_SHELL',
    'NSM_CREATE_CONTENT_PANEL_DOM',
    'NSM_CREATE_CONTENT_SOURCE_ACTION_MENU',
    'NSM_CREATE_CONTENT_SOURCE_ACTIONS',
    'NSM_CREATE_CONTENT_TAGS',
    'NSM_CREATE_CONTENT_STATE_RECONCILE',
    'NSM_CREATE_CONTENT_DEVELOPER_LOGGER',
    'NSM_CREATE_CONTENT_RUNTIME_STATE',
    'NSM_CREATE_CONTENT_MESSAGE_ROUTER',
    'NSM_CREATE_CONTENT_TOAST_STATUS',
    'NSM_CREATE_CONTENT_TOAST',
    'NSM_CREATE_CONTENT_STATE_APPLY',
    'NSM_CREATE_CONTENT_UNDO_HISTORY',
    'NSM_CREATE_CONTENT_IMPORT_EXPORT',
    'NSM_CREATE_CONTENT_DIAGNOSTICS',
    'NSM_CREATE_CONTENT_SOURCE_VIEW_SWITCH_CONTROLLER',
    'NSM_CREATE_CONTENT_PERSISTENCE',
    'NSM_CREATE_CONTENT_SOURCE_LIST_SCAN',
    'NSM_CREATE_CONTENT_NATIVE_LABEL_SCAN',
    'NSM_CREATE_CONTENT_NATIVE_LABEL_IMPORT',
    'NSM_CREATE_CONTENT_NATIVE_LABEL_IMPORT_CONTROLLER',
    'NSM_CREATE_CONTENT_NATIVE_LABEL_IMPORT_MODAL',
    'NSM_CREATE_CONTENT_SOURCE_PARTIAL_SYNC_GUARD',
    'NSM_CREATE_CONTENT_MODAL_FOCUS',
    'NSM_CREATE_CONTENT_MODAL_WELCOME',
    'NSM_CREATE_CONTENT_MODAL_WHATS_NEW',
    'NSM_CREATE_CONTENT_MODAL_TAG_FILTER',
    'NSM_CREATE_CONTENT_MODAL_MOVE',
    'NSM_CREATE_CONTENT_MODAL_COMMAND_PALETTE',
    'NSM_CREATE_CONTENT_MODAL_TAG',
    'NSM_CREATE_CONTENT_MODAL_SETTINGS',
    'NSM_CREATE_CONTENT_MODALS',
    'NSM_CREATE_CONTENT_RENDER',
    'NSM_CREATE_CONTENT_VIEW_STATE',
    'NSM_CREATE_CONTENT_TREE_INTERACTIONS',
    'NSM_CREATE_CONTENT_SOURCE_SYNC'
];

const setupGlobalMocks = () => {
    delete globalThis.__NSM_CONTENT_SCRIPT_INSTANCE__;
    global.__mutationObserverInstances = [];
    global.__resizeObserverInstances = [];
    global.__rafCallbacks = [];
    const sessionStorageData = new Map();

    const getComputedStyle = jest.fn((target) => ({
        display: target?.__computedStyle?.display ?? target?.style?.display ?? 'block',
        visibility: target?.__computedStyle?.visibility ?? target?.style?.visibility ?? 'visible',
        opacity: target?.__computedStyle?.opacity ?? target?.style?.opacity ?? '1',
        height: target?.__computedStyle?.height ?? target?.style?.height ?? '0px',
        backgroundColor: target?.__computedStyle?.backgroundColor ?? target?.style?.backgroundColor ?? '',
        backgroundImage: target?.__computedStyle?.backgroundImage ?? target?.style?.backgroundImage ?? ''
    }));

    global.window = {
        location: {
            pathname: '/notebook/testproject',
            origin: 'https://notebooklm.google.com',
            reload: jest.fn()
        },
        confirm: jest.fn(() => true),
        prompt: jest.fn(() => ''),
        getComputedStyle,
        requestAnimationFrame: jest.fn((cb) => {
            global.__rafCallbacks.push(cb);
            return global.__rafCallbacks.length;
        }),
        cancelAnimationFrame: jest.fn((id) => {
            if (id > 0 && id <= global.__rafCallbacks.length) {
                global.__rafCallbacks[id - 1] = null;
            }
        }),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn()
    };
    global.window.sessionStorage = {
        getItem: jest.fn((key) => sessionStorageData.get(key) || null),
        setItem: jest.fn((key, value) => {
            sessionStorageData.set(key, String(value));
        }),
        removeItem: jest.fn((key) => {
            sessionStorageData.delete(key);
        })
    };
    global.sessionStorage = global.window.sessionStorage;

    const mockElement = (tag = 'div') => {
        const listeners = new Map();
        const element = {
            tagName: String(tag).toUpperCase(),
            childNodes: [],
            children: [],
            style: {},
            attributes: {},
            attachShadow: jest.fn(() => ({
                querySelector: jest.fn(() => null),
                querySelectorAll: jest.fn(() => []),
                getElementById: jest.fn(() => ({ addEventListener: jest.fn() })),
                appendChild: jest.fn(),
            })),
            appendChild: jest.fn(function appendChild(node) {
                this.childNodes.push(node);
                this.children.push(node);
                if (node && typeof node === 'object') {
                    node.parentNode = this;
                }
                return node;
            }),
            replaceChildren: jest.fn(function replaceChildren(...nodes) {
                this.childNodes = [];
                this.children = [];
                nodes.forEach((node) => this.appendChild(node));
            }),
            removeChild: jest.fn(function removeChild(node) {
                this.childNodes = this.childNodes.filter((child) => child !== node);
                this.children = this.children.filter((child) => child !== node);
                return node;
            }),
            cloneNode: jest.fn(function cloneNode() { return this; }),
            setAttribute: jest.fn(function setAttribute(key, value) {
                this.attributes[key] = value;
                if (key === 'class') this.className = value;
                this[key] = value;
            }),
            removeAttribute: jest.fn(function removeAttribute(key) {
                delete this.attributes[key];
            }),
            getAttribute: jest.fn(function getAttribute(key) {
                return Object.prototype.hasOwnProperty.call(this.attributes, key) ? this.attributes[key] : null;
            }),
            addEventListener: jest.fn(function addEventListener(type, handler) {
                const handlers = listeners.get(type) || [];
                handlers.push(handler);
                listeners.set(type, handlers);
            }),
            dispatchEvent: jest.fn(function dispatchEvent(event) {
                const type = typeof event === 'string' ? event : event?.type;
                const handlers = listeners.get(type) || [];
                handlers.forEach((handler) => handler.call(this, event));
                return true;
            }),
            remove: jest.fn(),
            classList: { add: jest.fn(), remove: jest.fn() },
            dataset: {},
            matches: jest.fn(() => false),
            closest: jest.fn(() => null),
            querySelector: jest.fn(() => null),
            querySelectorAll: jest.fn(() => []),
            textContent: '',
            className: '',
        };

        return element;
    };

    global.document = {
        querySelector: jest.fn(() => null),
        querySelectorAll: jest.fn(() => []),
        getElementById: jest.fn(() => ({ addEventListener: jest.fn() })),
        createElement: jest.fn((tag) => mockElement(tag)),
        createDocumentFragment: jest.fn(() => ({
            childNodes: [],
            appendChild(node) {
                this.childNodes.push(node);
                return node;
            }
        })),
        createTextNode: jest.fn(),
        head: {
            appendChild: jest.fn()
        },
        body: {
            children: [],
            prepend: jest.fn(),
            contains: jest.fn(() => true),
            click: jest.fn(),
        },
        defaultView: {
            getComputedStyle
        },
        documentElement: {
            classList: {
                add: jest.fn(),
                remove: jest.fn()
            },
            addEventListener: jest.fn(),
            removeEventListener: jest.fn()
        },
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        visibilityState: 'visible',
    };

    global.MutationObserver = class {
        constructor(callback) {
            this.callback = callback;
            this.observe = jest.fn();
            this.disconnect = jest.fn();
            global.__mutationObserverInstances.push(this);
        }
    };
    global.ResizeObserver = class {
        constructor(callback) {
            this.callback = callback;
            this.observe = jest.fn();
            this.disconnect = jest.fn();
            global.__resizeObserverInstances.push(this);
        }
    };
    global.location = { href: 'http://localhost' };
    global.history = {
        pushState: jest.fn(),
        replaceState: jest.fn()
    };
    global.chrome = {
        i18n: { getMessage: (key) => key },
        runtime: {
            sendMessage: jest.fn((message, cb) => {
                if (message?.type === 'SAVE_STATE' && typeof cb === 'function') {
                    cb({ success: true, saveRevision: (Number(message.baseRevision) || 0) + 1, savedAt: '2026-04-22T00:00:00.000Z' });
                    return;
                }
                if (message?.type === 'APPEND_STATE_HISTORY' && typeof cb === 'function') {
                    cb({ success: true, history: message.entry ? [message.entry] : [] });
                    return;
                }
                if (message?.type === 'LOAD_STATE_HISTORY' && typeof cb === 'function') {
                    cb({ success: true, history: [] });
                    return;
                }
                if (message?.type === 'LOAD_PREFERENCES' && typeof cb === 'function') {
                    cb({
                        success: true,
                        preferences: {
                            developerModeEnabled: false,
                            welcomeOnboardingSeenVersion: 0,
                            whatsNewSeenVersion: '',
                            historyRetentionLimit: 20,
                            languageOverride: 'auto',
                            commandShortcuts: {},
                            visibleQuickViewKinds: ['all', 'ungrouped', 'disabled', 'tag', 'recent', 'issues']
                        },
                        usageState: {
                            hasExistingPluginData: false,
                            hasStoredPreferences: false
                        }
                    });
                    return;
                }
                if (message?.type === 'SAVE_PREFERENCES' && typeof cb === 'function') {
                    cb({
                        success: true,
                        preferences: Object.assign({
                            developerModeEnabled: false,
                            welcomeOnboardingSeenVersion: 0,
                            whatsNewSeenVersion: '',
                            historyRetentionLimit: 20,
                            languageOverride: 'auto',
                            commandShortcuts: {},
                            visibleQuickViewKinds: ['all', 'ungrouped', 'disabled', 'tag', 'recent', 'issues']
                        }, message.preferences || {})
                    });
                    return;
                }
                if (message?.type === 'LOAD_DEVELOPER_LOGS' && typeof cb === 'function') {
                    cb({ success: true, logs: [] });
                    return;
                }
                if (message?.type === 'APPEND_DEVELOPER_LOG' && typeof cb === 'function') {
                    cb({ success: true, logs: message.entry ? [message.entry] : [] });
                    return;
                }
                if (message?.type === 'CLEAR_DEVELOPER_LOGS' && typeof cb === 'function') {
                    cb({ success: true, logs: [] });
                }
            }),
            lastError: null,
            onMessage: {
                addListener: jest.fn(),
                removeListener: jest.fn()
            }
        },
        storage: {
            local: {
                set: jest.fn((data, cb) => {
                    if (typeof cb === 'function') cb();
                }),
                get: jest.fn((keys, cb) => {
                    if (typeof cb === 'function') cb({});
                })
            }
        }
    };
    if (typeof global.setTimeout !== 'function') {
        global.setTimeout = nativeSetTimeout;
    }
    if (typeof global.clearTimeout !== 'function') {
        global.clearTimeout = nativeClearTimeout;
    }

    const utils = require('../../src/utils/index.js');
    global.el = utils.el;
    global.debounce = utils.debounce;
    global.isDescendant = utils.isDescendant;
    global.getMessage = utils.getMessage;
};

const createMockSourceRow = ({
    title,
    ariaLabel = '',
    checked = false,
    disabled = false,
    hasCheckbox = true,
    iconName = 'article',
    stableToken = null,
    href = null,
    ariaControls = null,
    loading = false,
    statusText = '',
    status = null,
    imageCandidates = [],
    descendantCandidates = [],
    nativeMoreButton = null
}) => {
    const checkbox = {
        checked,
        disabled,
        click: jest.fn(),
        getAttribute: jest.fn((attr) => (attr === 'aria-label' ? ariaLabel : null))
    };
    const titleEl = { textContent: title };
    const iconEl = {
        textContent: iconName,
        classList: []
    };

    const tokenNode = stableToken ? {
        getAttribute: jest.fn((attr) => {
            if (attr === 'data-source-id') return stableToken;
            if (attr === 'href') return href;
            return null;
        })
    } : null;

    const ariaControlsNode = ariaControls ? {
        getAttribute: jest.fn((attr) => (attr === 'aria-controls' ? ariaControls : null))
    } : null;

    const hrefNode = href ? {
        getAttribute: jest.fn((attr) => (attr === 'href' ? href : null))
    } : null;

    const row = {
        children: [...imageCandidates, ...descendantCandidates],
        textContent: [title, statusText].filter(Boolean).join(' '),
        getAttribute: jest.fn((attr) => {
            if (attr === 'data-source-id') return stableToken;
            if (attr === 'href') return href;
            if (attr === 'aria-controls') return ariaControls;
            if (attr === 'aria-label') return ariaLabel;
            if (attr === 'title') return statusText;
            if (attr === 'data-status') return status;
            if (attr === 'data-state') return status;
            return null;
        }),
        querySelector: jest.fn((selector) => {
            if (selector.includes('source-title')) return titleEl;
            if (selector.includes('checkbox')) return hasCheckbox ? checkbox : null;
            if (selector.includes('mat-icon')) return iconEl;
            if (selector.includes('More options')) return nativeMoreButton;
            if (loading && selector.includes('[role="progressbar"]')) return { role: 'progressbar' };
            if (status === 'failed' && selector.includes('data-status="failed"')) return { status: 'failed' };
            return null;
        }),
        querySelectorAll: jest.fn((selector) => {
            if (selector === '[data-source-id]' && tokenNode) return [tokenNode];
            if (selector === '[href]' && hrefNode) return [hrefNode];
            if (selector === '[aria-controls]' && ariaControlsNode) return [ariaControlsNode];
            if (selector === 'img') return imageCandidates.filter((candidate) => candidate.tagName === 'IMG');
            if (selector === '[style*="background-image"]') {
                return imageCandidates.filter((candidate) => (
                    Boolean(candidate.style?.backgroundImage) ||
                    Boolean(candidate.__computedStyle?.backgroundImage)
                ));
            }
            if (selector === '[style*="background:"]') {
                return imageCandidates.filter((candidate) => Boolean(candidate.style?.background));
            }
            if (selector === '[style*="mask-image"]') {
                return imageCandidates.filter((candidate) => (
                    Boolean(candidate.style?.maskImage) ||
                    Boolean(candidate.__computedStyle?.maskImage)
                ));
            }
            if (selector === '[style*="webkit-mask-image"]') {
                return imageCandidates.filter((candidate) => (
                    Boolean(candidate.style?.webkitMaskImage) ||
                    Boolean(candidate.__computedStyle?.webkitMaskImage)
                ));
            }
            if (selector === '*') return descendantCandidates;
            return [];
        })
    };

    return { row, checkbox, titleEl, iconEl };
};

const createMockImageCandidate = ({
    src = null,
    currentSrc = null,
    backgroundImage = '',
    background = '',
    maskImage = '',
    webkitMaskImage = '',
    insideInteractive = false,
    interactiveAncestor = null,
    children = [],
    shadowChildren = []
} = {}) => {
    const computedStyle = {};
    if (backgroundImage) computedStyle.backgroundImage = backgroundImage;
    if (background) computedStyle.background = background;
    if (maskImage) computedStyle.maskImage = maskImage;
    if (webkitMaskImage) computedStyle.webkitMaskImage = webkitMaskImage;

    return ({
    tagName: src || currentSrc ? 'IMG' : 'DIV',
    src,
    currentSrc,
    children,
    shadowRoot: shadowChildren.length > 0 ? { children: shadowChildren } : null,
    style: {
        ...(backgroundImage ? { backgroundImage } : {}),
        ...(background ? { background } : {}),
        ...(maskImage ? { maskImage } : {}),
        ...(webkitMaskImage ? { webkitMaskImage } : {})
    },
    __computedStyle: computedStyle,
    getAttribute: jest.fn((attr) => {
        if (attr === 'src') return src;
        return null;
    }),
    closest: jest.fn(() => interactiveAncestor || (insideInteractive ? {} : null)),
    contains: jest.fn((node) => children.includes(node) || shadowChildren.includes(node))
    });
};

const createSearchUiMock = () => {
    const controls = {
        classList: {
            toggle: jest.fn()
        }
    };
    const searchCluster = {
        classList: {
            toggle: jest.fn()
        }
    };
    const searchContainer = {
        classList: {
            toggle: jest.fn()
        }
    };
    const searchInput = {
        value: '',
        tabIndex: 0,
        focus: jest.fn(),
        blur: jest.fn(),
        setAttribute: jest.fn()
    };
    const searchButton = {
        setAttribute: jest.fn()
    };
    const searchCloseButton = {
        classList: {
            toggle: jest.fn()
        },
        setAttribute: jest.fn()
    };
    const shadowRoot = {
        host: { isConnected: true, remove: jest.fn() },
        querySelector: jest.fn((selector) => {
            if (selector === '.sp-controls') return controls;
            if (selector === '.sp-search-cluster') return searchCluster;
            if (selector === '.sp-search-container') return searchContainer;
            return null;
        }),
        getElementById: jest.fn((id) => {
            if (id === 'sp-search') return searchInput;
            if (id === 'sp-search-btn') return searchButton;
            if (id === 'sp-search-close-btn') return searchCloseButton;
            return null;
        })
    };

    return {
        shadowRoot,
        controls,
        searchCluster,
        searchContainer,
        searchInput,
        searchButton,
        searchCloseButton
    };
};

const createTreeEl = (tag, attrs = {}, children = []) => ({
    tag,
    attrs,
    children
});

const createMockPanel = ({
    visible = true,
    width = 320,
    height = 640,
    contentVisible = visible,
    contentWidth = width,
    contentHeight = height
} = {}) => {
    const header = {
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        insertAdjacentElement: jest.fn()
    };
    const content = {
        isConnected: true,
        hidden: false,
        style: {
            display: contentVisible ? 'block' : 'none',
            visibility: contentVisible ? 'visible' : 'hidden'
        },
        __computedStyle: {
            display: contentVisible ? 'block' : 'none',
            visibility: contentVisible ? 'visible' : 'hidden'
        },
        getBoundingClientRect: jest.fn(() => ({
            width: contentVisible ? contentWidth : 0,
            height: contentVisible ? contentHeight : 0
        })),
        getAttribute: jest.fn(() => null),
        matches: jest.fn(() => false)
    };
    const panel = {
        isConnected: true,
        hidden: false,
        style: {
            display: visible ? 'block' : 'none',
            visibility: visible ? 'visible' : 'hidden'
        },
        __computedStyle: {
            display: visible ? 'block' : 'none',
            visibility: visible ? 'visible' : 'hidden'
        },
        getBoundingClientRect: jest.fn(() => ({
            width: visible ? width : 0,
            height: visible ? height : 0
        })),
        getAttribute: jest.fn(() => null),
        matches: jest.fn(() => false),
        querySelector: jest.fn((selector) => {
            if (selector === '.panel-header') return header;
            if (
                selector === '[data-testid="scroll-area"]' ||
                selector === '.scroll-area-desktop' ||
                selector === '.sources-list-container' ||
                selector === '.scroll-area'
            ) {
                return content;
            }
            return null;
        }),
        firstElementChild: header
    };

    return { panel, header, content };
};

const createInitShadowRoot = () => {
    const container = {
        style: {},
        classList: {
            add: jest.fn(),
            remove: jest.fn()
        },
        offsetWidth: 120
    };
    const resizer = {
        addEventListener: jest.fn()
    };
    const listContainer = {
        childNodes: [],
        addEventListener: jest.fn(),
        appendChild: jest.fn(),
        removeChild: jest.fn()
    };
    const viewStateContainer = {
        hidden: true,
        childNodes: [],
        addEventListener: jest.fn(),
        appendChild: jest.fn(),
        removeChild: jest.fn()
    };
    const searchInput = {
        value: '',
        tabIndex: 0,
        focus: jest.fn(),
        blur: jest.fn(),
        setAttribute: jest.fn(),
        addEventListener: jest.fn()
    };
    const searchButton = {
        setAttribute: jest.fn(),
        addEventListener: jest.fn()
    };
    const searchCloseButton = {
        classList: { toggle: jest.fn() },
        setAttribute: jest.fn(),
        addEventListener: jest.fn()
    };
    const genericButton = {
        classList: { toggle: jest.fn() },
        setAttribute: jest.fn(),
        addEventListener: jest.fn()
    };
    const shadowRoot = {
        host: {
            isConnected: true,
            remove: jest.fn()
        },
        appendChild: jest.fn(),
        addEventListener: jest.fn(),
        querySelector: jest.fn((selector) => {
            if (selector === '.sp-container') return container;
            if (selector === '.sp-resizer') return resizer;
            if (selector === '#sources-list') return listContainer;
            if (selector === '.sp-controls') {
                return { classList: { toggle: jest.fn() } };
            }
            if (selector === '.sp-search-cluster') {
                return { classList: { toggle: jest.fn() } };
            }
            if (selector === '.sp-search-container') {
                return { classList: { toggle: jest.fn() } };
            }
            return null;
        }),
        getElementById: jest.fn((id) => {
            if (id === 'sp-new-group-btn' || id === 'sp-manage-tags-btn' || id === 'sp-batch-action-btn') {
                return genericButton;
            }
            if (id === 'sp-search') return searchInput;
            if (id === 'sp-search-btn') return searchButton;
            if (id === 'sp-search-close-btn') return searchCloseButton;
            if (id === 'sp-view-state') return viewStateContainer;
            return genericButton;
        })
    };

    return {
        shadowRoot,
        host: shadowRoot.host,
        container,
        listContainer,
        viewStateContainer,
        searchInput,
        searchButton
    };
};

const teardownGlobalMocks = () => {
    delete global.window;
    delete global.document;
    delete global.MutationObserver;
    delete global.ResizeObserver;
    delete global.location;
    delete global.history;
    delete global.setTimeout;
    delete global.clearTimeout;
    delete global.chrome;
    delete global.el;
    delete global.debounce;
    delete global.isDescendant;
    delete global.getMessage;
    delete global.queueMicrotask;
    CONTENT_HELPER_GLOBALS.forEach((key) => delete global[key]);
    delete globalThis.__NSM_CONTENT_SCRIPT_INSTANCE__;
    delete global.__resizeObserverInstances;
    delete global.__mutationObserverInstances;
    delete global.__rafCallbacks;
};

const loadFreshContentModule = () => {
    jest.resetModules();
    setupGlobalMocks();
    const mod = loadContentModule();
    if (mod && typeof mod._resetState === 'function') {
        mod._resetState();
    }
    return mod;
};

module.exports = {
    CONTENT_HELPER_GLOBALS,
    setupGlobalMocks,
    teardownGlobalMocks,
    loadContentModule,
    loadFreshContentModule,
    createMockSourceRow,
    createMockImageCandidate,
    createSearchUiMock,
    createTreeEl,
    createMockPanel,
    createInitShadowRoot
};
