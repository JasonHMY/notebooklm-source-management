/**
 * Helper function to create DOM elements with attributes and children.
 * @param {string} tag - The HTML tag name.
 * @param {Object} attributes - Object containing attributes to set on the element.
 * @param {Array} children - Array of children (strings or Nodes) to append to the element.
 * @returns {HTMLElement} The created element.
 */
function el(tag, attributes = {}, children = []) {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes)) {
        if (key === 'className' && value) {
            element.className = value;
        } else if (key === 'dataset' && value) {
            for (const [dKey, dVal] of Object.entries(value)) {
                element.dataset[dKey] = dVal;
            }
        } else if (value !== false && value != null) {
            const lowerKey = key.toLowerCase();
            if (lowerKey.startsWith('on')) {
                console.warn(`GeminiNotebook-Source-Management: Blocked insecure attribute key: ${key}`);
                continue;
            }
            if (['href', 'src', 'action', 'formaction', 'srcdoc'].includes(lowerKey) && String(value).toLowerCase().replace(/[\s\x00-\x1F]/g, '').startsWith('javascript:')) {
                console.warn(`GeminiNotebook-Source-Management: Blocked insecure attribute value for ${key}`);
                continue;
            }
            element.setAttribute(key, value === true ? '' : value);
        }
    }
    for (const child of children) {
        if (typeof child === 'string') {
            element.appendChild(document.createTextNode(child));
        } else if (child instanceof Node) {
            element.appendChild(child);
        }
    }
    return element;
}

/**
 * Debounce a function with cancel, flush, and isPending support.
 * @param {Function} func - The function to debounce.
 * @param {number} wait - The wait time in milliseconds.
 * @returns {Function} The debounced function.
 */
function debounce(func, wait) {
    let timeout = null;
    let lastArgs = null;
    let lastThis = null;

    const invoke = () => {
        timeout = null;
        const args = lastArgs;
        const context = lastThis;
        lastArgs = null;
        lastThis = null;
        return func.apply(context, args || []);
    };

    function executedFunction(...args) {
        lastArgs = args;
        lastThis = this;
        if (timeout) {
            clearTimeout(timeout);
        }
        timeout = setTimeout(invoke, wait);
    }

    executedFunction.cancel = () => {
        if (timeout) {
            clearTimeout(timeout);
        }
        timeout = null;
        lastArgs = null;
        lastThis = null;
    };

    executedFunction.flush = () => {
        if (!timeout) return false;
        clearTimeout(timeout);
        invoke();
        return true;
    };

    executedFunction.isPending = () => timeout !== null;

    return executedFunction;
}

/**
 * Checks if a group is a descendant of another group.
 * @param {Object} possibleChild - The potential child group object.
 * @param {Object} possibleParent - The potential parent group object.
 * @param {Map} groupsById - A Map containing all groups keyed by their IDs.
 * @returns {boolean} True if possibleChild is a descendant of possibleParent, false otherwise.
 */
function isDescendant(possibleChild, possibleParent, groupsById) {
    if (!possibleChild || !possibleParent || possibleChild.id === possibleParent.id) return true;
    if (!groupsById || typeof groupsById.get !== 'function') return false;

    const stack = [possibleParent];
    const visited = new Set();
    while (stack.length > 0) {
        const group = stack.pop();
        if (!group || visited.has(group.id)) continue;
        visited.add(group.id);

        for (const child of group.children || []) {
            if (child?.type !== 'group') continue;
            if (child.id === possibleChild.id) return true;
            if (!visited.has(child.id)) {
                stack.push(groupsById.get(child.id));
            }
        }
    }
    return false;
}

const SUPPORTED_MANUAL_MESSAGE_LOCALES = new Set(['en', 'es', 'zh_CN']);
const DEFAULT_MESSAGE_LOCALE = 'en';
let messageLocaleOverride = 'auto';
const localeMessageCache = new Map();
const localeMessageLoadPromises = new Map();

function normalizeMessageLocaleOverride(locale) {
    const normalized = String(locale || 'auto').trim();
    return normalized === 'auto' || SUPPORTED_MANUAL_MESSAGE_LOCALES.has(normalized)
        ? normalized
        : 'auto';
}

function getChromeApi() {
    return typeof globalThis !== 'undefined' && globalThis.chrome ? globalThis.chrome : null;
}

function normalizeHtmlLanguage(locale) {
    return String(locale || DEFAULT_MESSAGE_LOCALE).replace('_', '-');
}

function getUiLanguage() {
    const chromeApi = getChromeApi();
    if (chromeApi?.i18n && typeof chromeApi.i18n.getUILanguage === 'function') {
        return chromeApi.i18n.getUILanguage() || DEFAULT_MESSAGE_LOCALE;
    }
    return DEFAULT_MESSAGE_LOCALE;
}

function getEffectiveMessageLocale() {
    return messageLocaleOverride === 'auto'
        ? getUiLanguage()
        : normalizeHtmlLanguage(messageLocaleOverride);
}

function getLocaleMessagesPath(locale) {
    return `_locales/${locale}/messages.json`;
}

function loadLocaleMessages(locale) {
    const normalizedLocale = SUPPORTED_MANUAL_MESSAGE_LOCALES.has(locale) ? locale : DEFAULT_MESSAGE_LOCALE;
    if (localeMessageCache.has(normalizedLocale)) {
        return Promise.resolve(localeMessageCache.get(normalizedLocale));
    }
    if (localeMessageLoadPromises.has(normalizedLocale)) {
        return localeMessageLoadPromises.get(normalizedLocale);
    }

    const chromeApi = getChromeApi();
    const runtime = chromeApi?.runtime || null;
    const fetchFn = typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function'
        ? globalThis.fetch.bind(globalThis)
        : null;
    if (!runtime || typeof runtime.getURL !== 'function' || !fetchFn) {
        localeMessageCache.set(normalizedLocale, null);
        return Promise.resolve(null);
    }

    const loadPromise = fetchFn(runtime.getURL(getLocaleMessagesPath(normalizedLocale)))
        .then((response) => (response && response.ok && typeof response.json === 'function' ? response.json() : null))
        .then((messages) => {
            const catalog = messages && typeof messages === 'object' ? messages : null;
            localeMessageCache.set(normalizedLocale, catalog);
            return catalog;
        })
        .catch(() => {
            localeMessageCache.set(normalizedLocale, null);
            return null;
        })
        .finally(() => {
            localeMessageLoadPromises.delete(normalizedLocale);
        });
    localeMessageLoadPromises.set(normalizedLocale, loadPromise);
    return loadPromise;
}

function setMessageLocaleOverride(locale) {
    messageLocaleOverride = normalizeMessageLocaleOverride(locale);
    if (messageLocaleOverride === 'auto') {
        return Promise.resolve(messageLocaleOverride);
    }
    return loadLocaleMessages(messageLocaleOverride).then(() => messageLocaleOverride);
}

function getMessageLocaleOverride() {
    return messageLocaleOverride;
}

function getSubstitutionList(substitutions) {
    if (Array.isArray(substitutions)) return substitutions.map((item) => String(item));
    if (substitutions == null) return [];
    return [String(substitutions)];
}

function applyMessageSubstitutions(message, substitutions) {
    const values = getSubstitutionList(substitutions);
    return String(message || '').replace(/\$(\d+)/g, (match, indexText) => {
        const index = Number(indexText) - 1;
        return Object.prototype.hasOwnProperty.call(values, index) ? values[index] : match;
    });
}

function getManualLocaleMessage(key, substitutions) {
    if (messageLocaleOverride === 'auto') return '';
    const catalog = localeMessageCache.get(messageLocaleOverride);
    const entry = catalog && catalog[key];
    if (!entry || typeof entry.message !== 'string') return '';
    return applyMessageSubstitutions(entry.message, substitutions);
}

/**
 * Retrieve an i18n message from the selected extension locale, falling back to chrome.i18n and then the key.
 * @param {string} key - The message key.
 * @param {string|string[]} [substitutions] - Optional substitution strings.
 * @returns {string} The localized message or the key as fallback.
 */
function getMessage(key, substitutions) {
    const manualMessage = getManualLocaleMessage(key, substitutions);
    if (manualMessage) return manualMessage;

    const chromeApi = getChromeApi();
    if (!chromeApi?.i18n?.getMessage) return key;
    return chromeApi.i18n.getMessage(key, substitutions) || key;
}

globalThis.NSM_SET_MESSAGE_LOCALE_OVERRIDE = setMessageLocaleOverride;
globalThis.NSM_GET_MESSAGE_LOCALE_OVERRIDE = getMessageLocaleOverride;
globalThis.NSM_GET_EFFECTIVE_MESSAGE_LOCALE = getEffectiveMessageLocale;

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        el,
        debounce,
        isDescendant,
        getMessage,
        setMessageLocaleOverride,
        getMessageLocaleOverride,
        getEffectiveMessageLocale,
        normalizeMessageLocaleOverride,
        loadLocaleMessages,
        _applyMessageSubstitutionsForTest: applyMessageSubstitutions,
        _localeMessageCacheForTest: localeMessageCache
    };
}
