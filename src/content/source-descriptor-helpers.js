(function () {
    'use strict';

    // SECURITY: every value this module extracts from NotebookLM DOM (title,
    // aria-label, icon URL, attributes, row identity) is UNTRUSTED input.
    // Consumers MUST render strings via el() text-node path — never innerHTML,
    // eval, or dynamic Function. Icon URLs must pass the trusted-host check
    // below before being put in <img src>. See docs/SECURITY_THREAT_MODEL.md.

    const contentConfig = globalThis.NSM_CONTENT_CONFIG;

    if (!contentConfig || !contentConfig.DEPS) {
        throw new Error('GeminiNotebook-Source-Management: Content config is missing.');
    }

    const { DEPS } = contentConfig;

    const MAX_EXPLICIT_ICON_CANDIDATES = 24;
    const MAX_FALLBACK_ICON_CANDIDATES = 18;
    const MAX_QUERY_RESULTS_PER_SELECTOR = 12;
    const MAX_SAFE_DATA_IMAGE_URL_LENGTH = 32 * 1024;
    const NOTEBOOKLM_IMAGE_ORIGIN = 'https://notebook.google.com';
    const NOTEBOOKLM_IMAGE_ORIGINS = new Set([
        NOTEBOOKLM_IMAGE_ORIGIN,
        'https://notebooklm.google.com'
    ]);
    const TRUSTED_IMAGE_HOSTS = new Set([
        'notebook.google.com',
        'notebooklm.google.com',
        'gstatic.com',
        'googleusercontent.com',
        'ggpht.com'
    ]);
    const TRUSTED_IMAGE_HOST_SUFFIXES = [
        '.gstatic.com',
        '.googleusercontent.com',
        '.ggpht.com'
    ];
    const SOURCE_PROCESSING_SELECTOR = [
        '[role="progressbar"]',
        'mat-spinner',
        'mat-progress-spinner',
        'mat-progress-bar',
        '.mat-mdc-progress-spinner',
        '.mat-mdc-progress-bar',
        '.mdc-circular-progress',
        '.mdc-linear-progress',
        'svg animateTransform'
    ].join(', ');
    const SOURCE_PROCESSING_STATUS_SELECTORS = [
        '[aria-busy="true"]',
        '[role="status"]',
        '[aria-live]',
        '[data-state]',
        '[data-status]',
        '[data-testid*="loading" i]',
        '[data-testid*="processing" i]',
        '[data-testid*="upload" i]',
        '[class*="loading" i]',
        '[class*="processing" i]'
    ];
    const SOURCE_PROCESSING_DISCOVERY_SELECTORS = [
        SOURCE_PROCESSING_SELECTOR,
        ...SOURCE_PROCESSING_STATUS_SELECTORS
    ];
    const SOURCE_PROCESSING_DISCOVERY_SELECTOR = SOURCE_PROCESSING_DISCOVERY_SELECTORS.join(', ');
    const SOURCE_FAILURE_SELECTOR = [
        '[aria-invalid="true"]',
        '[data-state="failed"]',
        '[data-status="failed"]',
        '[data-state="failure"]',
        '[data-status="failure"]',
        '[data-state="error"]',
        '[data-status="error"]',
        '[data-state="invalid"]',
        '[data-status="invalid"]',
        '[data-state="unsupported"]',
        '[data-status="unsupported"]',
        '[data-testid*="failed" i]',
        '[data-testid*="error" i]'
    ].join(', ');
    const SOURCE_FAILURE_ICON_PATTERN = /^(?:error|error_outline|report_problem|warning|warning_amber|cancel|cancel_outline|dangerous|failure)$/i;
    const SOURCE_PROCESSING_TEXT_PATTERN = /\b(?:loading|analy[sz](?:ing|e)?|processing|parsing|uploading|importing|adding|pending)\b|正在|正在添加|添加中|载入|載入|加载|讀取|读取|分析|处理中|處理中|cargando|analizando|procesando|importando|subiendo/i;
    const SOURCE_PROCESSING_STATUS_VALUE_PATTERN = /^(?:true|loading|loaded_pending|in_progress|analy[sz](?:ing|e)?|processing|parsing|uploading|importing|adding|pending|正在|正在添加|添加中|载入|載入|加载|讀取|读取|分析|处理中|處理中|cargando|analizando|procesando|importando|subiendo)$/i;
    const STABLE_SOURCE_TOKEN_ATTRIBUTES = [
        'data-source-id',
        'data-source-key',
        'data-source-token',
        'data-source-uuid',
        'data-source-document-id',
        'data-source-file-id',
        'data-source-resource-id',
        'data-notebook-source-id',
        'data-document-id',
        'data-doc-id',
        'data-docid',
        'data-drive-id',
        'data-drive-file-id',
        'data-file-id',
        'data-resource-id',
        'data-resource-key',
        'data-item-id',
        'data-record-id',
        'data-uuid',
        'data-id'
    ];
    const STABLE_SOURCE_REFERENCE_ATTRIBUTES = [
        'href',
        'data-href',
        'data-url',
        'data-link',
        'data-source-url',
        'data-document-url',
        'data-drive-url',
        'data-file-url',
        'aria-describedby',
        'aria-labelledby'
    ];
    const STABLE_SOURCE_ATTRIBUTES = [
        ...STABLE_SOURCE_TOKEN_ATTRIBUTES,
        ...STABLE_SOURCE_REFERENCE_ATTRIBUTES
    ];
    const STABLE_SOURCE_SELECTORS = STABLE_SOURCE_ATTRIBUTES.map(
        (attributeKey) => `[${attributeKey}]`
    );

    function findElement(selectors, parent) {
        const root = parent || document;
        for (const selector of Array.isArray(selectors) ? selectors : []) {
            const element = root.querySelector(selector);
            if (element) return element;
        }
        return null;
    }

    function generateSourceKey(title) {
        let hash = 0;
        const normalizedTitle = String(title || '');
        for (let i = 0; i < normalizedTitle.length; i++) {
            const char = normalizedTitle.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0;
        }
        return `source_${hash}`;
    }

    function normalizeSourceText(value) {
        return String(value || '')
            .trim()
            .replace(/\s+/g, ' ')
            .toLowerCase();
    }

    function sanitizeSourceToken(value) {
        return normalizeSourceText(value)
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 96);
    }

    function extractTokenFromUrl(url) {
        if (typeof url !== 'string' || !url) return null;

        try {
            const parsedUrl = new URL(url, window.location.origin);
            const preferredParams = [
                'source', 'sourceId', 'source_id',
                'documentId', 'document_id',
                'docId', 'doc_id',
                'fileId', 'file_id',
                'resourceId', 'resource_id',
                'id'
            ];

            for (const key of preferredParams) {
                const value = parsedUrl.searchParams.get(key);
                const sanitized = sanitizeSourceToken(value ? `${key}:${value}` : '');
                if (sanitized) return sanitized;
            }

            const segments = parsedUrl.pathname.split('/').filter(Boolean);
            const stablePathKeys = new Set([
                'd',
                'doc',
                'docs',
                'document',
                'documents',
                'drive',
                'file',
                'files',
                'folder',
                'folders',
                'resource',
                'resources',
                'source',
                'sources'
            ]);
            for (let index = 0; index < segments.length - 1; index++) {
                const segment = segments[index];
                const nextSegment = segments[index + 1];
                if (stablePathKeys.has(String(segment || '').toLowerCase()) && /[A-Za-z0-9_-]{6,}/.test(nextSegment)) {
                    return sanitizeSourceToken(`${segment}:${nextSegment}`);
                }
            }

            const lastSegment = segments[segments.length - 1];
            if (lastSegment && /[A-Za-z0-9_-]{6,}/.test(lastSegment)) {
                return sanitizeSourceToken(`${segments[segments.length - 2] || 'path'}:${lastSegment}`);
            }
        } catch (error) {
            return null;
        }

        return null;
    }

    function extractTokenFromReferenceValue(attributeKey, value) {
        const trimmedValue = String(value || '').trim();
        if (!attributeKey || !trimmedValue) return null;

        if (attributeKey === 'href') {
            return extractTokenFromUrl(trimmedValue);
        }

        if (/(?:href|url|link)$/i.test(attributeKey)) {
            const urlToken = extractTokenFromUrl(trimmedValue);
            const sanitizedUrlToken = sanitizeSourceToken(urlToken ? `${attributeKey}:${urlToken}` : '');
            if (sanitizedUrlToken) return sanitizedUrlToken;
        }

        if (attributeKey.startsWith('data-')) {
            return sanitizeSourceToken(`${attributeKey}:${trimmedValue}`);
        }

        if (attributeKey === 'aria-describedby' || attributeKey === 'aria-labelledby') {
            const parts = trimmedValue.split(/\s+/).filter(Boolean);
            const stableReferencePattern = /(?:source|document|doc|drive|file|resource|item)[-_:]?[A-Za-z0-9_-]{6,}/i;
            const idLikePattern = /[A-Za-z0-9_-]{12,}/;
            const reference = parts.find((part) => stableReferencePattern.test(part)) ||
                (/(?:source|document|doc|drive|file|resource|item)/i.test(trimmedValue)
                    ? parts.find((part) => idLikePattern.test(part))
                    : null);
            const sanitized = sanitizeSourceToken(reference ? `${attributeKey}:${reference}` : '');
            if (sanitized) return sanitized;
        }

        return null;
    }

    function getElementSignalText(element) {
        if (!element) return '';
        const parts = [];
        if (typeof element.textContent === 'string') parts.push(element.textContent);
        if (typeof element.getAttribute === 'function') {
            [
                'aria-label',
                'title',
                'data-state',
                'data-status',
                'data-testid',
                'aria-describedby',
                'aria-labelledby'
            ].forEach((attributeKey) => {
                const value = element.getAttribute(attributeKey);
                if (value) parts.push(value);
            });
        }
        return parts.join(' ');
    }

    function getElementOwnSignalText(element) {
        if (!element) return '';
        const parts = [];
        if (typeof element.textContent === 'string') parts.push(element.textContent);
        if (typeof element.getAttribute === 'function') {
            [
                'aria-label',
                'title',
                'data-state',
                'data-status',
                'data-testid',
                'class',
                'aria-busy'
            ].forEach((attributeKey) => {
                const value = element.getAttribute(attributeKey);
                if (value) parts.push(value);
            });
        }
        return parts.join(' ');
    }

    function isElementVisibleForSignal(element) {
        if (!element) return false;
        let current = element;
        while (current) {
            if (current.hidden === true) return false;
            if (typeof current.getAttribute === 'function') {
                if (current.getAttribute('hidden') != null) return false;
                if (current.getAttribute('aria-hidden') === 'true') return false;
            }
            const style = current.style || current.__computedStyle || null;
            if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') {
                return false;
            }
            const computedStyle = typeof window !== 'undefined' && typeof window.getComputedStyle === 'function'
                ? window.getComputedStyle(current)
                : null;
            if (
                computedStyle &&
                (computedStyle.display === 'none' ||
                    computedStyle.visibility === 'hidden' ||
                    computedStyle.visibility === 'collapse')
            ) {
                return false;
            }
            current = current.parentElement || null;
        }
        return true;
    }

    function queryVisibleProcessingElements(sourceElement) {
        if (!sourceElement || typeof sourceElement.querySelectorAll !== 'function') return [];
        if (typeof sourceElement.querySelector === 'function') {
            try {
                if (!sourceElement.querySelector(SOURCE_PROCESSING_DISCOVERY_SELECTOR)) return [];
            } catch (error) {
                // Some NotebookLM DOM variants can reject a combined selector even
                // though one of its individual selectors remains supported.
            }
        }
        const seen = new Set();
        const elements = [];
        SOURCE_PROCESSING_DISCOVERY_SELECTORS.forEach((selector) => {
            try {
                Array.from(sourceElement.querySelectorAll(selector)).forEach((element) => {
                    if (!element || seen.has(element) || !isElementVisibleForSignal(element)) return;
                    seen.add(element);
                    elements.push(element);
                });
            } catch (error) {
                // Ignore selector support differences in NotebookLM's runtime DOM.
            }
            if (typeof sourceElement.querySelector === 'function') {
                try {
                    const element = sourceElement.querySelector(selector);
                    if (element && !seen.has(element) && isElementVisibleForSignal(element)) {
                        seen.add(element);
                        elements.push(element);
                    }
                } catch (error) {
                    // Ignore selector support differences in NotebookLM's runtime DOM.
                }
            }
        });
        return elements;
    }

    function getSourceSignalControls(sourceElement, sourceControls) {
        if (sourceControls) return sourceControls;
        return {
            titleEl: findElement(DEPS.title, sourceElement),
            checkbox: findElement(DEPS.checkbox, sourceElement),
            nativeMoreButton: findElement(DEPS.moreBtn, sourceElement)
        };
    }

    function hasReadySourceActionSignal(sourceElement, sourceControls) {
        if (!sourceElement) return false;
        const { checkbox, nativeMoreButton } = getSourceSignalControls(sourceElement, sourceControls);
        return Boolean(
            nativeMoreButton ||
            (checkbox && checkbox.disabled !== true)
        );
    }

    function hasProcessingStatusAttribute(element) {
        if (!element || typeof element.getAttribute !== 'function') return false;
        if (element.getAttribute('aria-busy') === 'true') return true;
        return ['data-state', 'data-status', 'data-testid', 'class'].some((attributeKey) => {
            const value = element.getAttribute(attributeKey);
            return SOURCE_PROCESSING_STATUS_VALUE_PATTERN.test(String(value || '').trim());
        });
    }

    function removeKnownSourceTitleText(text, titleEl) {
        const titleText = String(titleEl?.textContent || '').replace(/\s+/g, ' ').trim();
        let remainingText = String(text || '').replace(/\s+/g, ' ').trim();
        if (!titleText || !remainingText) return remainingText;

        return remainingText
            .split(titleText)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function isLikelyProcessingStatusTextElement(element, sourceElement, sourceControls) {
        if (!element || element === sourceElement) return false;

        const { titleEl, checkbox, nativeMoreButton } = sourceControls;
        if (element === titleEl || element === checkbox || element === nativeMoreButton) return false;

        const tagName = String(element.tagName || '').toLowerCase();
        const role = typeof element.getAttribute === 'function'
            ? String(element.getAttribute('role') || '').toLowerCase()
            : '';
        if (
            tagName === 'button' ||
            tagName === 'input' ||
            tagName === 'select' ||
            tagName === 'textarea' ||
            role === 'button' ||
            role === 'checkbox' ||
            role === 'menuitem'
        ) {
            return false;
        }

        const signalText = removeKnownSourceTitleText(getElementOwnSignalText(element), titleEl);
        return SOURCE_PROCESSING_TEXT_PATTERN.test(signalText) && isElementVisibleForSignal(element);
    }

    function getBoundedSourceDescendants(sourceElement) {
        if (!sourceElement || !sourceElement.children) return null;
        try {
            const elements = [];
            const pending = Array.from(sourceElement.children).reverse();
            const maxElements = MAX_QUERY_RESULTS_PER_SELECTOR * 4;
            while (pending.length > 0 && elements.length < maxElements) {
                const element = pending.pop();
                if (!element) continue;
                elements.push(element);
                if (element.children) {
                    Array.from(element.children).reverse().forEach((child) => pending.push(child));
                }
            }
            return {
                elements,
                truncated: pending.length > 0
            };
        } catch (error) {
            return null;
        }
    }

    function hasVisibleProcessingStatusText(sourceElement, sourceControls) {
        if (!sourceElement) return false;
        const resolvedSourceControls = getSourceSignalControls(sourceElement, sourceControls);
        const descendantResult = getBoundedSourceDescendants(sourceElement);
        if (descendantResult) {
            return descendantResult.elements.some((element) => isLikelyProcessingStatusTextElement(
                element,
                sourceElement,
                resolvedSourceControls
            ));
        }
        if (typeof sourceElement.querySelectorAll !== 'function') return false;
        try {
            return Array.from(sourceElement.querySelectorAll('*'))
                .slice(0, MAX_QUERY_RESULTS_PER_SELECTOR * 4)
                .some((element) => isLikelyProcessingStatusTextElement(
                    element,
                    sourceElement,
                    resolvedSourceControls
                ));
        } catch (error) {
            return false;
        }
    }

    function hasSourceProcessingSignal(sourceElement, sourceControls) {
        if (!sourceElement) return false;
        const resolvedSourceControls = getSourceSignalControls(sourceElement, sourceControls);
        if (typeof sourceElement.querySelector === 'function') {
            try {
                const processingIndicator = sourceElement.querySelector(SOURCE_PROCESSING_SELECTOR);
                if (processingIndicator && isElementVisibleForSignal(processingIndicator)) {
                    return true;
                }
            } catch (error) {
                // Ignore selector support differences in NotebookLM's runtime DOM.
            }
        }
        const visibleProcessingElements = queryVisibleProcessingElements(sourceElement);
        if (visibleProcessingElements.some((element) => (
            hasProcessingStatusAttribute(element) ||
            SOURCE_PROCESSING_SELECTOR.split(',').some((selector) => {
                try {
                    return typeof element.matches === 'function' && element.matches(selector.trim());
                } catch (error) {
                    return false;
                }
            }) ||
            SOURCE_PROCESSING_TEXT_PATTERN.test(getElementOwnSignalText(element))
        ))) {
            return true;
        }

        if (hasProcessingStatusAttribute(sourceElement)) {
            return true;
        }

        if (hasVisibleProcessingStatusText(sourceElement, resolvedSourceControls)) {
            return true;
        }

        if (!hasReadySourceActionSignal(sourceElement, resolvedSourceControls)) {
            return SOURCE_PROCESSING_TEXT_PATTERN.test(getElementSignalText(sourceElement));
        }
        return false;
    }

    function isFailureIconCandidate(element) {
        if (!element) return false;
        if (String(element.tagName || '').toLowerCase() === 'mat-icon') return true;
        const className = typeof element.getAttribute === 'function'
            ? String(element.getAttribute('class') || '')
            : String(element.className || '');
        if (/(?:^|\s)(?:material-icons|google-symbols)(?:\s|$)/.test(className)) return true;
        const role = typeof element.getAttribute === 'function'
            ? String(element.getAttribute('role') || '').toLowerCase()
            : '';
        return role === 'img';
    }

    function hasVisibleFailureIconSignal(element) {
        const iconSignal = String(
            element?.textContent || element?.getAttribute?.('aria-label') || ''
        ).trim();
        return SOURCE_FAILURE_ICON_PATTERN.test(iconSignal) && isElementVisibleForSignal(element);
    }

    function hasVisibleFailureIconCandidate(candidates) {
        let iconCount = 0;
        const maxIcons = MAX_QUERY_RESULTS_PER_SELECTOR * 2;
        for (const element of candidates) {
            if (!isFailureIconCandidate(element)) continue;
            iconCount += 1;
            if (iconCount > maxIcons) break;
            if (hasVisibleFailureIconSignal(element)) return true;
        }
        return false;
    }

    function hasVisibleSourceFailureIcon(sourceElement) {
        const descendantResult = getBoundedSourceDescendants(sourceElement);
        if (descendantResult && !descendantResult.truncated) {
            return hasVisibleFailureIconCandidate(descendantResult.elements);
        }
        if (typeof sourceElement?.querySelectorAll !== 'function') return false;
        try {
            return Array.from(sourceElement.querySelectorAll('mat-icon, .material-icons, .google-symbols, [role="img"]'))
                .slice(0, MAX_QUERY_RESULTS_PER_SELECTOR * 2)
                .some((element) => hasVisibleFailureIconSignal(element));
        } catch (error) {
            return false;
        }
    }

    function hasSourceFailureSignal(sourceElement) {
        if (!sourceElement) return false;
        const hasExplicitFailureStatusAttribute = (element) => {
            if (!element || typeof element.getAttribute !== 'function') return false;
            if (element.getAttribute('aria-invalid') === 'true') return true;
            return ['data-state', 'data-status'].some((attributeKey) => (
                /^(?:failed|failure|error|invalid|unsupported)$/i.test(
                    String(element.getAttribute(attributeKey) || '').trim()
                )
            ));
        };
        const hasVisibleFailureElement = (element) => (
            element && isElementVisibleForSignal(element)
        );
        if (hasExplicitFailureStatusAttribute(sourceElement) && hasVisibleFailureElement(sourceElement)) {
            return true;
        }
        let firstFailureStatus = null;
        let failureStatusQueryFailed = typeof sourceElement.querySelector !== 'function';
        if (!failureStatusQueryFailed) {
            try {
                firstFailureStatus = sourceElement.querySelector(SOURCE_FAILURE_SELECTOR);
            } catch (error) {
                // Ignore selector support differences in NotebookLM's runtime DOM.
                failureStatusQueryFailed = true;
            }
        }
        if (hasVisibleFailureElement(firstFailureStatus)) return true;
        // The normal path has no status candidate. Only scan every candidate when a
        // first matching status exists but is hidden; a later visible status must still
        // win over a stale hidden one.
        if (
            (firstFailureStatus || failureStatusQueryFailed)
            && typeof sourceElement.querySelectorAll === 'function'
        ) {
            try {
                if (Array.from(sourceElement.querySelectorAll(SOURCE_FAILURE_SELECTOR))
                    .some((element) => (
                        element !== firstFailureStatus && hasVisibleFailureElement(element)
                    ))) {
                    return true;
                }
            } catch (error) {
                // Ignore selector support differences in NotebookLM's runtime DOM.
            }
        }
        return hasVisibleSourceFailureIcon(sourceElement);
    }

    function extractSourceStableToken(sourceRow) {
        if (!sourceRow) return null;

        const extractCandidateToken = (candidate) => {
            if (!candidate || typeof candidate.getAttribute !== 'function') return null;
            for (const attributeKey of STABLE_SOURCE_ATTRIBUTES) {
                const attributeValue = candidate.getAttribute(attributeKey);
                const token = extractTokenFromReferenceValue(attributeKey, attributeValue);
                if (token) return token;
            }
            return null;
        };
        const sourceToken = extractCandidateToken(sourceRow);
        if (sourceToken) return sourceToken;
        if (typeof sourceRow.querySelectorAll !== 'function') return null;

        for (const selector of STABLE_SOURCE_SELECTORS) {
            const candidates = Array.from(sourceRow.querySelectorAll(selector)).slice(0, 8);
            for (const candidate of candidates) {
                const token = extractCandidateToken(candidate);
                if (token) return token;
            }
        }

        return null;
    }

    function extractCssUrl(value) {
        if (typeof value !== 'string' || !value) return null;
        const match = value.match(/url\((['"]?)(.*?)\1\)/i);
        return match && match[2] ? match[2] : null;
    }

    function getSourceImageBaseUrl() {
        return window.location.href || window.location.origin || location.href || NOTEBOOKLM_IMAGE_ORIGIN;
    }

    function getCurrentExtensionId() {
        return typeof globalThis.chrome?.runtime?.id === 'string' ? globalThis.chrome.runtime.id : '';
    }

    function isTrustedSourceImageHost(hostname) {
        const normalizedHost = String(hostname || '').toLowerCase();
        return TRUSTED_IMAGE_HOSTS.has(normalizedHost) ||
            TRUSTED_IMAGE_HOST_SUFFIXES.some((suffix) => normalizedHost.endsWith(suffix));
    }

    function isSafeRasterDataImageUrl(value) {
        if (typeof value !== 'string' || value.length > MAX_SAFE_DATA_IMAGE_URL_LENGTH) return false;
        return /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(value);
    }

    function isAllowedBlobSourceImageUrl(value) {
        if (!String(value || '').toLowerCase().startsWith('blob:')) return false;
        try {
            const blobInnerUrl = new URL(String(value).slice('blob:'.length));
            return NOTEBOOKLM_IMAGE_ORIGINS.has(blobInnerUrl.origin);
        } catch (error) {
            return false;
        }
    }

    function isAllowedExtensionSourceImageUrl(parsedUrl) {
        const extensionId = getCurrentExtensionId();
        return Boolean(
            parsedUrl &&
            parsedUrl.protocol === 'chrome-extension:' &&
            extensionId &&
            parsedUrl.hostname === extensionId
        );
    }

    function resolveSourceImageUrl(url) {
        if (typeof url !== 'string') return null;

        const trimmed = url.trim();
        if (!trimmed || trimmed === 'none') return null;

        if (trimmed.toLowerCase().startsWith('data:')) {
            return isSafeRasterDataImageUrl(trimmed) ? trimmed : null;
        }

        if (trimmed.toLowerCase().startsWith('blob:')) {
            return isAllowedBlobSourceImageUrl(trimmed) ? trimmed : null;
        }

        try {
            const parsedUrl = new URL(trimmed, getSourceImageBaseUrl());
            if (isAllowedExtensionSourceImageUrl(parsedUrl)) {
                return parsedUrl.href;
            }
            if (parsedUrl.protocol !== 'https:') {
                return null;
            }
            return isTrustedSourceImageHost(parsedUrl.hostname) ? parsedUrl.href : null;
        } catch (error) {
            return null;
        }
    }

    function isIgnoredSourceImageCandidate(candidate, sourceElement, context = {}) {
        if (!candidate) return true;

        const { checkbox = null, nativeMoreButton = null } = context;

        if (checkbox && (candidate === checkbox || checkbox.contains?.(candidate))) {
            return true;
        }
        if (nativeMoreButton && (candidate === nativeMoreButton || nativeMoreButton.contains?.(candidate))) {
            return true;
        }

        const ignoredAncestorSelector = [
            '[role="menu"]',
            '[role="menuitem"]',
            '[role="checkbox"]',
            'input',
            'mat-checkbox'
        ].join(', ');
        const ignoredAncestor = typeof candidate.closest === 'function'
            ? candidate.closest(ignoredAncestorSelector)
            : null;
        if (ignoredAncestor && ignoredAncestor !== sourceElement) {
            return true;
        }

        return false;
    }

    function appendCandidate(candidates, seenCandidates, candidate, maxCandidates) {
        if (!candidate || seenCandidates.has(candidate) || candidates.length >= maxCandidates) return;
        seenCandidates.add(candidate);
        candidates.push(candidate);
    }

    function collectConfiguredImageCandidates(sourceElement) {
        const candidates = [];
        const seenCandidates = new Set();
        const selectors = Array.isArray(DEPS.iconImage) ? DEPS.iconImage : [];

        if (selectors.length === 0) return candidates;
        let sourceMatchesConfiguredSelector = false;
        if (typeof sourceElement.matches === 'function') {
            try {
                sourceMatchesConfiguredSelector = sourceElement.matches(selectors.join(', '));
            } catch (error) {
                sourceMatchesConfiguredSelector = true;
            }
        }
        if (!sourceMatchesConfiguredSelector && typeof sourceElement.querySelector === 'function') {
            try {
                const hasDescendantCandidate = Boolean(sourceElement.querySelector(selectors.join(', ')));
                if (!hasDescendantCandidate) return candidates;
            } catch (error) {
                // Preserve the individual-selector fallback for DOM variants that
                // reject the combined image selector.
            }
        }

        for (const selector of selectors) {
            if (candidates.length >= MAX_EXPLICIT_ICON_CANDIDATES) break;

            if (typeof sourceElement.matches === 'function' && sourceElement.matches(selector)) {
                appendCandidate(candidates, seenCandidates, sourceElement, MAX_EXPLICIT_ICON_CANDIDATES);
            }

            const nodes = sourceElement.querySelectorAll
                ? Array.from(sourceElement.querySelectorAll(selector)).slice(0, MAX_QUERY_RESULTS_PER_SELECTOR)
                : [];

            nodes.forEach((node) => appendCandidate(candidates, seenCandidates, node, MAX_EXPLICIT_ICON_CANDIDATES));
        }

        return candidates;
    }

    function hasInlineVisualHint(candidate) {
        return Boolean(
            extractCssUrl(candidate.style?.backgroundImage) ||
            extractCssUrl(candidate.style?.background) ||
            extractCssUrl(candidate.style?.webkitMaskImage) ||
            extractCssUrl(candidate.style?.maskImage)
        );
    }

    function shouldInspectComputedStyle(candidate) {
        if (!candidate) return false;

        const tagName = String(candidate.tagName || '').toUpperCase();
        if (tagName === 'IMG' || tagName === 'PICTURE' || tagName === 'SVG' || tagName === 'CANVAS') {
            return true;
        }

        if (candidate.getAttribute?.('role') === 'img') {
            return true;
        }

        if (hasInlineVisualHint(candidate)) {
            return true;
        }

        return tagName === 'DIV' || tagName === 'SPAN' || tagName === 'MAT-ICON';
    }

    function extractCandidateImageUrl(candidate) {
        if (!candidate) return null;

        const directUrl = resolveSourceImageUrl(
            candidate.currentSrc ||
            candidate.src ||
            (typeof candidate.getAttribute === 'function' ? candidate.getAttribute('src') : '')
        );
        if (directUrl) return directUrl;

        const inlineVisualUrl = resolveSourceImageUrl(
            extractCssUrl(candidate.style?.backgroundImage) ||
            extractCssUrl(candidate.style?.background) ||
            extractCssUrl(candidate.style?.webkitMaskImage) ||
            extractCssUrl(candidate.style?.maskImage)
        );
        if (inlineVisualUrl) return inlineVisualUrl;

        if (!shouldInspectComputedStyle(candidate) || typeof window.getComputedStyle !== 'function') {
            return null;
        }

        const computedStyle = window.getComputedStyle(candidate);
        const computedImageUrl = resolveSourceImageUrl(
            extractCssUrl(computedStyle?.backgroundImage) ||
            extractCssUrl(computedStyle?.background) ||
            extractCssUrl(computedStyle?.webkitMaskImage) ||
            extractCssUrl(computedStyle?.maskImage)
        );
        if (computedImageUrl) return computedImageUrl;

        return null;
    }

    function collectFallbackImageCandidates(sourceElement, seededCandidates = []) {
        const candidates = [];
        const seenCandidates = new Set(seededCandidates);

        appendCandidate(candidates, seenCandidates, sourceElement, MAX_FALLBACK_ICON_CANDIDATES);

        const directChildren = Array.from(sourceElement.children || []);
        directChildren.forEach((child) => {
            appendCandidate(candidates, seenCandidates, child, MAX_FALLBACK_ICON_CANDIDATES);
            if (child?.shadowRoot?.children) {
                Array.from(child.shadowRoot.children).forEach((shadowChild) => {
                    appendCandidate(candidates, seenCandidates, shadowChild, MAX_FALLBACK_ICON_CANDIDATES);
                });
            }
        });

        if (sourceElement.shadowRoot?.children) {
            Array.from(sourceElement.shadowRoot.children).forEach((shadowChild) => {
                appendCandidate(candidates, seenCandidates, shadowChild, MAX_FALLBACK_ICON_CANDIDATES);
            });
        }

        return candidates;
    }

    function extractSourceIconImageUrl(sourceElement, context = {}) {
        if (!sourceElement) return null;

        const explicitCandidates = collectConfiguredImageCandidates(sourceElement);
        for (const candidate of explicitCandidates) {
            if (isIgnoredSourceImageCandidate(candidate, sourceElement, context)) continue;
            const imageUrl = extractCandidateImageUrl(candidate);
            if (imageUrl) return imageUrl;
        }

        const fallbackCandidates = collectFallbackImageCandidates(sourceElement, explicitCandidates);
        for (const candidate of fallbackCandidates) {
            if (isIgnoredSourceImageCandidate(candidate, sourceElement, context)) continue;
            const imageUrl = extractCandidateImageUrl(candidate);
            if (imageUrl) return imageUrl;
        }

        return null;
    }

    function buildLegacySourceKey(keyTitle, seenLegacyKeys) {
        const baseKey = generateSourceKey(keyTitle);
        const duplicateIndex = seenLegacyKeys.get(baseKey) || 0;
        seenLegacyKeys.set(baseKey, duplicateIndex + 1);
        return duplicateIndex === 0 ? baseKey : `${baseKey}_${duplicateIndex}`;
    }

    function extractSourceTextFallback(sourceElement) {
        const rawText = String(sourceElement?.textContent || '')
            .replace(/\s+/g, ' ')
            .trim();
        if (!rawText) return '';

        const statusPattern = /\b(parsing|loading|analyzing|importing|failed|error|处理中|加载中|正在分析|导入失败|出错)\b/gi;
        return rawText
            .replace(statusPattern, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function extractSourceIdentitySnapshot(sourceElement) {
        if (!sourceElement) return null;

        const titleEl = findElement(DEPS.title, sourceElement);
        const checkbox = findElement(DEPS.checkbox, sourceElement);
        const checkboxAriaLabel = checkbox && typeof checkbox.getAttribute === 'function'
            ? (checkbox.getAttribute('aria-label') || '')
            : '';
        const rowAriaLabel = typeof sourceElement.getAttribute === 'function'
            ? (sourceElement.getAttribute('aria-label') || '')
            : '';
        const ariaLabel = checkboxAriaLabel || rowAriaLabel;
        const textFallback = extractSourceTextFallback(sourceElement);
        const explicitTitle = titleEl?.textContent.trim() || ariaLabel || textFallback;
        const title = explicitTitle || getMessage('ui_source_untitled');
        const nativeMoreButton = findElement(DEPS.moreBtn, sourceElement);
        const nativeIconContext = {
            titleEl,
            checkbox,
            nativeMoreButton
        };

        let iconEl = findElement(DEPS.icon, sourceElement);
        let iconName = iconEl?.textContent.trim() || 'article';
        const iconMap = {
            'video_youtube': 'smart_display',
            'more_vert': 'article',
            'audiotrack': 'headphones',
            'picture_as_pdf': 'description',
            'drive_pdf': 'description',
            'link': 'link',
            'format_quote': 'format_quote',
            'text_snippet': 'article',
            'note': 'sticky_note_2'
        };

        if (iconMap[iconName]) {
            iconName = iconMap[iconName];
            if (iconName === 'article' && iconEl?.textContent.trim() === 'more_vert') {
                iconEl = null;
            }
        }

        const stableToken = extractSourceStableToken(sourceElement);
        const hasProcessingSignal = hasSourceProcessingSignal(sourceElement, nativeIconContext);
        const hasFailureSignal = hasSourceFailureSignal(sourceElement);
        const normalizedTitle = normalizeSourceText(title);
        const normalizedAriaLabel = normalizeSourceText(ariaLabel);
        const fingerprintAriaLabel = normalizedAriaLabel && normalizedAriaLabel !== normalizedTitle
            ? normalizedAriaLabel
            : '';
        const fingerprint = [
            normalizedTitle,
            fingerprintAriaLabel,
            normalizeSourceText(iconName)
        ].join('|');

        return {
            titleEl,
            checkbox,
            nativeMoreButton,
            iconEl,
            iconName,
            title,
            normalizedTitle,
            ariaLabel,
            stableToken,
            fingerprint,
            nativeIconContext,
            hasProcessingSignal,
            hasFailureSignal,
            hasTitleSignal: Boolean(titleEl || explicitTitle),
            hasActionSignal: Boolean(checkbox || nativeMoreButton || stableToken || hasProcessingSignal || hasFailureSignal)
        };
    }

    function isManageableSourceIdentity(identity) {
        return Boolean(identity && identity.hasTitleSignal && identity.hasActionSignal);
    }

    function createSourceDescriptor(sourceElement, seenSourceIds, seenLegacyKeys) {
        const identity = extractSourceIdentitySnapshot(sourceElement);
        if (!isManageableSourceIdentity(identity)) {
            return null;
        }
        const {
            titleEl,
            checkbox,
            nativeMoreButton,
            ariaLabel,
            title,
            normalizedTitle,
            stableToken,
            fingerprint,
            iconName,
            iconEl,
            nativeIconContext,
            hasProcessingSignal,
            hasFailureSignal
        } = identity || {};
        const keyTitle = ariaLabel || titleEl?.textContent || '';

        const iconColorClass = Array.from(iconEl?.classList || []).find((className) => className.endsWith('-icon-color')) || '';
        const iconImageUrl = extractSourceIconImageUrl(sourceElement, nativeIconContext);
        const identityType = stableToken ? 'stable-token' : 'fingerprint';
        const sourceIdBase = stableToken
            ? `source_id_${stableToken}`
            : `source_fp_${generateSourceKey(fingerprint)}`;
        const duplicateIndex = seenSourceIds.get(sourceIdBase) || 0;
        seenSourceIds.set(sourceIdBase, duplicateIndex + 1);
        const key = duplicateIndex === 0 ? sourceIdBase : `${sourceIdBase}_${duplicateIndex}`;
        const legacyKey = buildLegacySourceKey(keyTitle, seenLegacyKeys);
        const isLoading = Boolean(hasProcessingSignal);
        const hasNativeCheckbox = Boolean(checkbox);
        const isFailed = Boolean(hasFailureSignal && !isLoading);
        const isDisabled = Boolean(checkbox?.disabled || isLoading || isFailed);

        return {
            key,
            legacyKey,
            title,
            normalizedTitle,
            lowercaseTitle: normalizedTitle,
            ariaLabel,
            stableToken,
            fingerprint,
            identityType,
            element: sourceElement,
            iconName,
            iconColorClass,
            iconImageUrl,
            checkbox,
            hasNativeCheckbox,
            hasNativeActionMenu: Boolean(nativeMoreButton),
            isLoading,
            isFailed,
            isDisabled
        };
    }

    const sourceDescriptorHelpers = {
        createSourceDescriptor,
        extractSourceIdentitySnapshot,
        extractSourceIconImageUrl,
        extractSourceStableToken,
        extractTokenFromUrl,
        extractTokenFromReferenceValue,
        hasSourceProcessingSignal,
        hasSourceFailureSignal,
        extractCssUrl,
        generateSourceKey,
        isManageableSourceIdentity,
        normalizeSourceText,
        resolveSourceImageUrl,
        sanitizeSourceToken
    };

    globalThis.NSM_SOURCE_DESCRIPTOR_HELPERS = sourceDescriptorHelpers;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = sourceDescriptorHelpers;
    }
})();
