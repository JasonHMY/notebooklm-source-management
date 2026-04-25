(function () {
    'use strict';

    function createContentSourceSync(deps = {}) {
        const runtime = deps.runtime && typeof deps.runtime === 'object' ? deps.runtime : deps;

        const getDocument = typeof deps.getDocument === 'function'
            ? deps.getDocument
            : () => (runtime.document || globalThis.document || null);
        const getWindow = typeof deps.getWindow === 'function'
            ? deps.getWindow
            : () => (runtime.window || globalThis.window || null);
        const getDEPS = typeof deps.getDEPS === 'function'
            ? deps.getDEPS
            : () => (runtime.DEPS || globalThis.NSM_CONTENT_CONFIG?.DEPS || {});
        const getMessage = typeof deps.getMessage === 'function'
            ? deps.getMessage
            : (key) => key;
        const findElement = typeof deps.findElement === 'function'
            ? deps.findElement
            : (selectors, parent) => {
                const root = parent || getDocument();
                if (!root || typeof root.querySelector !== 'function') return null;
                for (const selector of Array.isArray(selectors) ? selectors : []) {
                    const element = root.querySelector(selector);
                    if (element) return element;
                }
                return null;
            };
        const findSourcePanel = typeof deps.findSourcePanel === 'function'
            ? deps.findSourcePanel
            : () => null;
        const isSourcePanelRenderable = typeof deps.isSourcePanelRenderable === 'function'
            ? deps.isSourcePanelRenderable
            : () => false;
        const isManageableSourceIdentity = typeof deps.isManageableSourceIdentity === 'function'
            ? deps.isManageableSourceIdentity
            : () => false;
        const hasPreservableManagerSnapshot = typeof deps.hasPreservableManagerSnapshot === 'function'
            ? deps.hasPreservableManagerSnapshot
            : () => false;
        const isSourceEffectivelyEnabled = typeof deps.isSourceEffectivelyEnabled === 'function'
            ? deps.isSourceEffectivelyEnabled
            : (source) => Boolean(source && source.enabled);
        const createSourceDescriptor = typeof deps.createSourceDescriptor === 'function'
            ? deps.createSourceDescriptor
            : () => null;
        const extractSourceIdentitySnapshot = typeof deps.extractSourceIdentitySnapshot === 'function'
            ? deps.extractSourceIdentitySnapshot
            : () => null;
        const buildSourceLookup = typeof deps.buildSourceLookup === 'function'
            ? deps.buildSourceLookup
            : () => ({});
        const resolveStoredSourceKeyWithReason = typeof deps.resolveStoredSourceKeyWithReason === 'function'
            ? deps.resolveStoredSourceKeyWithReason
            : () => ({ key: null, reason: 'unresolved' });
        const buildResolvedSourceStateById = typeof deps.buildResolvedSourceStateById === 'function'
            ? deps.buildResolvedSourceStateById
            : () => new Map();
        const buildNormalizedTagState = typeof deps.buildNormalizedTagState === 'function'
            ? deps.buildNormalizedTagState
            : () => null;
        const buildResolvedSourceTagsById = typeof deps.buildResolvedSourceTagsById === 'function'
            ? deps.buildResolvedSourceTagsById
            : () => new Map();
        const reconcilePersistedTree = typeof deps.reconcilePersistedTree === 'function'
            ? deps.reconcilePersistedTree
            : () => ({
                groups: [],
                ungrouped: [],
                groupsById: new Map(),
                seenSourceRefs: new Set()
            });
        const snapshotExistingSourceRecords = typeof deps.snapshotExistingSourceRecords === 'function'
            ? deps.snapshotExistingSourceRecords
            : () => new Map();
        const remapExistingStateToCurrentSources = typeof deps.remapExistingStateToCurrentSources === 'function'
            ? deps.remapExistingStateToCurrentSources
            : () => ({
                groups: [],
                ungrouped: [],
                groupsById: new Map(),
                sourceStateById: new Map(),
                sourceTagsById: new Map(),
                seenSourceRefs: new Set()
            });
        const setSourceTagIds = typeof deps.setSourceTagIds === 'function'
            ? deps.setSourceTagIds
            : () => {};
        const syncSourceToPage = typeof deps.syncSourceToPage === 'function'
            ? deps.syncSourceToPage
            : () => {};
        const buildParentMap = typeof deps.buildParentMap === 'function'
            ? deps.buildParentMap
            : () => {};
        const buildPersistableState = typeof deps.buildPersistableState === 'function'
            ? deps.buildPersistableState
            : null;
        const saveState = typeof deps.saveState === 'function'
            ? deps.saveState
            : () => {};
        const render = typeof deps.render === 'function'
            ? deps.render
            : () => {};
        const suspendManagerForSourceDetailView = typeof deps.suspendManagerForSourceDetailView === 'function'
            ? deps.suspendManagerForSourceDetailView
            : () => {};
        const flushPendingInitialLoadedState = typeof deps.flushPendingInitialLoadedState === 'function'
            ? deps.flushPendingInitialLoadedState
            : () => ({ deferred: false, shouldUpgradeStorage: false });
        const debounceFn = typeof deps.debounce === 'function'
            ? deps.debounce
            : (typeof globalThis.debounce === 'function' ? globalThis.debounce : null);

        const ensureMap = (name) => {
            const current = runtime[name];
            if (current instanceof Map) {
                return current;
            }

            const next = new Map();
            runtime[name] = next;
            return next;
        };

        const getState = () => {
            if (runtime.state && typeof runtime.state === 'object') {
                return runtime.state;
            }

            const next = {
                groups: [],
                ungrouped: [],
                filterQuery: '',
                isBatchMode: false,
                tagOrder: [],
                activeTagId: null
            };
            runtime.state = next;
            return next;
        };

        const getSourcesByKey = () => ensureMap('sourcesByKey');
        const getSourceTagsById = () => ensureMap('sourceTagsById');
        const getGroupsById = () => ensureMap('groupsById');
        const getParentMap = () => ensureMap('parentMap');
        const getKeyByElement = () => {
            if (runtime.keyByElement instanceof WeakMap) {
                return runtime.keyByElement;
            }
            const next = new WeakMap();
            runtime.keyByElement = next;
            return next;
        };
        const getFreshRowCache = () => {
            const current = runtime.freshRowCache;
            if (current == null || current instanceof Map) {
                return current;
            }
            const next = new Map();
            runtime.freshRowCache = next;
            return next;
        };
        const setFreshRowCache = (value) => {
            runtime.freshRowCache = value;
            return value;
        };
        const getPendingInitialLoadedState = () => runtime.pendingInitialLoadedState ?? null;
        const setPendingInitialLoadedState = (value) => {
            runtime.pendingInitialLoadedState = value;
            return value;
        };
        const getPendingStorageUpgrade = () => Boolean(runtime.pendingStorageUpgrade);
        const setPendingStorageUpgrade = (value) => {
            runtime.pendingStorageUpgrade = Boolean(value);
            return runtime.pendingStorageUpgrade;
        };
        const getIsAwaitingInitialStateLoad = () => Boolean(runtime.isAwaitingInitialStateLoad);
        const getSourceDetailViewRequested = () => Boolean(runtime.sourceDetailViewRequested);
        const setSourceDetailViewRequested = (value) => {
            runtime.sourceDetailViewRequested = Boolean(value);
            return runtime.sourceDetailViewRequested;
        };
        const isSuppressingReadyStateForSourceDetail = () => (
            getSourceDetailViewRequested() &&
            Number(runtime.sourceDetailViewReadySuppressionUntil || 0) > Date.now()
        );
        const getExtensionHost = () => runtime.extensionHost || null;
        const getShadowRoot = () => runtime.shadowRoot || null;
        const getScrollObserver = () => runtime.scrollObserver || null;

        function getStableComparableValue(value, seenValues = new WeakSet()) {
            if (value == null || typeof value !== 'object') {
                return value;
            }

            if (seenValues.has(value)) {
                return '[Circular]';
            }
            seenValues.add(value);

            try {
                if (Array.isArray(value)) {
                    return value.map((item) => getStableComparableValue(item, seenValues));
                }

                if (value instanceof Map) {
                    return Array.from(value.entries())
                        .sort(([leftKey], [rightKey]) => String(leftKey).localeCompare(String(rightKey)))
                        .map(([key, item]) => [String(key), getStableComparableValue(item, seenValues)]);
                }

                return Object.keys(value)
                    .sort()
                    .reduce((acc, key) => {
                        acc[key] = getStableComparableValue(value[key], seenValues);
                        return acc;
                    }, {});
            } finally {
                seenValues.delete(value);
            }
        }

        function getPersistableStateSignature() {
            if (!buildPersistableState) return null;

            try {
                return JSON.stringify(getStableComparableValue(buildPersistableState()));
            } catch (error) {
                return null;
            }
        }

        function shouldSaveAfterMutationSync(previousSignature, nextSignature) {
            return previousSignature == null || nextSignature == null || previousSignature !== nextSignature;
        }

        const SOURCE_RENAME_ATTRIBUTE_NAMES = new Set([
            'aria-label',
            'title',
            'alt',
            'data-source-id',
            'data-document-id',
            'data-doc-id',
            'data-file-id',
            'data-drive-id',
            'data-resource-id',
            'data-testid',
            'href'
        ]);

        const SOURCE_DETAIL_HEADING_PATTERNS = [
            /\bsource\s+guide\b/i,
            /\bsource\s+details?\b/i,
            /来源指南/,
            /来源详情/
        ];
        const SOURCE_DETAIL_CLOSE_PATTERNS = [
            /\bclose\s+source\s+guide\b/i,
            /\bclose\s+source\s+details?\b/i,
            /关闭来源指南/,
            /关闭来源详情/
        ];
        const SOURCE_VIEW_KIND_LIST = 'list';
        const SOURCE_VIEW_KIND_LABEL = 'label';
        const SOURCE_VIEW_KIND_UNKNOWN = 'unknown';
        const LABEL_GROUP_SELECTORS = [
            '[data-testid*="source-label" i]',
            '[data-testid*="label-group" i]',
            '[data-testid*="source-group" i]',
            '[data-testid*="category" i]',
            '[aria-label*="label" i]',
            '[aria-label*="category" i]',
            '[aria-label*="标签"]',
            '[aria-label*="分类"]',
            '.source-label',
            '.source-label-group',
            '.source-group',
            '.label-group'
        ];
        const LABEL_TITLE_SELECTORS = [
            '[data-testid*="label-title" i]',
            '[data-testid*="group-title" i]',
            '[data-testid*="category-title" i]',
            '[role="heading"]',
            'h1',
            'h2',
            'h3',
            'h4',
            'h5',
            'h6',
            '.source-label-title',
            '.label-title',
            '.group-title'
        ];
        const LABEL_SOURCE_ROW_SELECTORS = [
            '[data-testid="source-item"]',
            '.single-source-container',
            '[data-testid*="source-card" i]',
            '[data-testid*="source-row" i]',
            '[data-testid*="source-item" i]',
            '[data-source-id]',
            '[data-document-id]',
            '[data-doc-id]',
            '[data-file-id]',
            '[data-drive-id]',
            '[data-resource-id]'
        ];
        const LABEL_VIEW_TEXT_PATTERN = /\b(label|labels|categor(?:y|ies|ize)|group|groups)\b|标签|分类|分组/i;

        function getElementTextSignal(element) {
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
        }

        function matchesAnyTextPattern(text, patterns) {
            if (!text) return false;
            return patterns.some((pattern) => pattern.test(text));
        }

        function queryPanelElements(panel, selectors) {
            const queryRoot = panel && typeof panel.querySelectorAll === 'function' ? panel : getDocument();
            if (!queryRoot || typeof queryRoot.querySelectorAll !== 'function') return [];
            const matchedElements = [];
            const seenElements = new Set();
            for (const selector of selectors) {
                try {
                    Array.from(queryRoot.querySelectorAll(selector)).forEach((element) => {
                        if (!seenElements.has(element)) {
                            seenElements.add(element);
                            matchedElements.push(element);
                        }
                    });
                } catch (error) {
                    // Ignore selector support differences in NotebookLM's runtime DOM.
                }
            }
            return matchedElements;
        }

        function getAttributeValue(element, attr) {
            if (!element || typeof element.getAttribute !== 'function') return '';
            return String(element.getAttribute(attr) || '').trim();
        }

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

        function getElementOwnLabel(element) {
            if (!element) return '';
            const dataCandidates = [
                element.dataset?.sourceLabel,
                element.dataset?.labelTitle,
                getAttributeValue(element, 'data-source-label'),
                getAttributeValue(element, 'data-label-title'),
                getAttributeValue(element, 'data-label')
            ].filter(Boolean);
            const dataLabel = dataCandidates.find((value) => String(value || '').trim());
            if (dataLabel) return String(dataLabel).replace(/\s+/g, ' ').trim();

            const titleElement = findElement(LABEL_TITLE_SELECTORS, element);
            const title = String(titleElement?.textContent || getAttributeValue(titleElement, 'aria-label') || '').replace(/\s+/g, ' ').trim();
            if (title && title.length <= 120) return title;

            const accessibleCandidates = [
                getAttributeValue(element, 'aria-label'),
                getAttributeValue(element, 'title')
            ].filter(Boolean);
            const direct = accessibleCandidates
                .map(cleanAccessibleLabelTitle)
                .find((value) => LABEL_VIEW_TEXT_PATTERN.test(value) || value.length <= 80);
            return direct ? direct.replace(/\s+/g, ' ').trim() : '';
        }

        function elementMatchesAny(element, selectors) {
            if (!element || typeof element.matches !== 'function') return false;
            return selectors.some((selector) => {
                try {
                    return Boolean(element.matches(selector));
                } catch (error) {
                    return false;
                }
            });
        }

        function isNodeHiddenForSourceScan(element, boundary = null) {
            if (!element) return true;
            if ('isConnected' in element && element.isConnected === false) return true;

            const win = getWindow();
            let cursor = element;
            let depth = 0;
            while (cursor && depth < 24) {
                if (cursor.hidden === true) return true;
                if (getAttributeValue(cursor, 'aria-hidden') === 'true') return true;
                const style = cursor.style || {};
                if (
                    style.display === 'none' ||
                    style.visibility === 'hidden' ||
                    style.visibility === 'collapse'
                ) {
                    return true;
                }
                try {
                    const computedStyle = typeof win?.getComputedStyle === 'function'
                        ? win.getComputedStyle(cursor)
                        : null;
                    if (
                        computedStyle &&
                        (
                            computedStyle.display === 'none' ||
                            computedStyle.visibility === 'hidden' ||
                            computedStyle.visibility === 'collapse'
                        )
                    ) {
                        return true;
                    }
                } catch (error) {
                    // Some mocked or framework-owned nodes cannot be passed to getComputedStyle.
                }
                if (boundary && cursor === boundary) break;
                cursor = getParentElement(cursor);
                depth += 1;
            }
            return false;
        }

        function getParentElement(element) {
            return element?.parentElement || element?.parentNode || null;
        }

        function findNativeLabelTitle(row, panel) {
            if (!row) return '';
            if (typeof row.__nativeLabelTitle === 'string' && row.__nativeLabelTitle.trim()) {
                return row.__nativeLabelTitle.trim();
            }

            const rowLabel = getElementOwnLabel(row);
            if (getAttributeValue(row, 'data-source-label') || getAttributeValue(row, 'data-label-title')) {
                return rowLabel;
            }

            let cursor = getParentElement(row);
            let depth = 0;
            while (cursor && cursor !== panel && depth < 8) {
                if (!isNodeHiddenForSourceScan(cursor, panel) && elementMatchesAny(cursor, LABEL_GROUP_SELECTORS)) {
                    const label = getElementOwnLabel(cursor);
                    if (label) return label;
                }
                cursor = getParentElement(cursor);
                depth += 1;
            }

            return '';
        }

        function createSourceViewInfo(kind, confidence, extra = {}) {
            return Object.assign({
                kind,
                confidence,
                detectedAt: new Date().toISOString()
            }, extra || {});
        }

        function updateRuntimeSourceViewInfo(info) {
            const nextInfo = info || createSourceViewInfo(SOURCE_VIEW_KIND_UNKNOWN, 0);
            const previousKind = runtime.sourceViewKind || SOURCE_VIEW_KIND_UNKNOWN;
            runtime.sourceViewKind = nextInfo.kind || SOURCE_VIEW_KIND_UNKNOWN;
            runtime.sourceViewConfidence = Number(nextInfo.confidence) || 0;
            runtime.sourceViewInfo = nextInfo;
            if (previousKind !== runtime.sourceViewKind || !runtime.lastSourceViewChangedAt) {
                runtime.lastSourceViewChangedAt = nextInfo.detectedAt || new Date().toISOString();
            }
            return nextInfo;
        }

        function getSourceViewInfo(panel = findSourcePanel()) {
            return updateRuntimeSourceViewInfo(detectSourceView(panel));
        }

        function getListSourceEntries(parent = getDocument(), options = {}) {
            const depsConfig = getDEPS();
            const rows = queryPanelElements(parent, Array.isArray(depsConfig.row) ? depsConfig.row : []);
            const shouldFilterHidden = Boolean(options.filterHidden);
            return rows
                .filter((row) => !shouldFilterHidden || !isNodeHiddenForSourceScan(row, parent))
                .map((row) => ({
                    row,
                    viewKind: SOURCE_VIEW_KIND_LIST,
                    nativeLabelTitle: ''
                }));
        }

        function getLabelSourceEntries(parent = getDocument()) {
            const rows = queryPanelElements(parent, LABEL_SOURCE_ROW_SELECTORS);
            const seenRows = new Set();
            const entries = [];

            rows.forEach((row) => {
                if (!row || seenRows.has(row) || isNodeHiddenForSourceScan(row, parent)) return;
                const identity = extractSourceIdentitySnapshot(row);
                if (!isManageableSourceIdentity(identity)) return;

                const nativeLabelTitle = findNativeLabelTitle(row, parent);
                if (!nativeLabelTitle) return;
                seenRows.add(row);
                entries.push({
                    row,
                    viewKind: SOURCE_VIEW_KIND_LABEL,
                    nativeLabelTitle
                });
            });

            return entries;
        }

        function detectSourceView(panel = findSourcePanel()) {
            const sourcePanel = panel || findSourcePanel();
            if (!sourcePanel || !isSourcePanelRenderable(sourcePanel)) {
                return createSourceViewInfo(SOURCE_VIEW_KIND_UNKNOWN, 0, {
                    listRows: 0,
                    labelRows: 0,
                    labelGroups: 0
                });
            }

            const labelEntries = getLabelSourceEntries(sourcePanel);
            const labelGroups = queryPanelElements(sourcePanel, LABEL_GROUP_SELECTORS)
                .filter((group) => !isNodeHiddenForSourceScan(group, sourcePanel));
            const listEntries = getListSourceEntries(sourcePanel);
            const labelTextSignals = labelGroups.filter((group) => LABEL_VIEW_TEXT_PATTERN.test(getElementTextSignal(group)));

            if (labelEntries.length > 0) {
                return createSourceViewInfo(SOURCE_VIEW_KIND_LABEL, labelTextSignals.length > 0 ? 0.92 : 0.82, {
                    listRows: listEntries.length,
                    labelRows: labelEntries.length,
                    labelGroups: labelGroups.length
                });
            }

            if (listEntries.length > 0) {
                return createSourceViewInfo(SOURCE_VIEW_KIND_LIST, 0.9, {
                    listRows: listEntries.length,
                    labelRows: 0,
                    labelGroups: labelGroups.length
                });
            }

            if (labelGroups.length > 0 || labelTextSignals.length > 0) {
                return createSourceViewInfo(SOURCE_VIEW_KIND_LABEL, 0.45, {
                    listRows: 0,
                    labelRows: 0,
                    labelGroups: labelGroups.length
                });
            }

            return createSourceViewInfo(SOURCE_VIEW_KIND_UNKNOWN, 0, {
                listRows: 0,
                labelRows: 0,
                labelGroups: 0
            });
        }

        function getSourceEntries(parent = getDocument()) {
            const info = getSourceViewInfo(parent);
            if (info.kind === SOURCE_VIEW_KIND_LABEL) {
                const labelEntries = getLabelSourceEntries(parent);
                if (labelEntries.length > 0) return labelEntries;
                return getListSourceEntries(parent, { filterHidden: true });
            }
            return getListSourceEntries(parent);
        }

        function hasNativeSourceDetailView(panel) {
            const accessibleControls = queryPanelElements(panel, [
                'button[aria-label], [role="button"][aria-label], [aria-label], button[title], [role="button"][title]'
            ]);
            if (accessibleControls.some((element) => (
                matchesAnyTextPattern(getElementTextSignal(element), SOURCE_DETAIL_CLOSE_PATTERNS)
            ))) {
                return true;
            }

            const headings = queryPanelElements(panel, [
                '[role="heading"]',
                'h1, h2, h3, h4, h5, h6'
            ]);
            return headings.some((element) => (
                matchesAnyTextPattern(getElementTextSignal(element), SOURCE_DETAIL_HEADING_PATTERNS)
            ));
        }

        function hasSourceLoadingIndicator(sourceElement) {
            return Boolean(extractSourceIdentitySnapshot(sourceElement)?.hasProcessingSignal);
        }

        function isDetailLikeSourceIdentity(identity) {
            return Boolean(
                identity &&
                identity.titleEl &&
                !identity.checkbox &&
                !identity.nativeMoreButton &&
                !identity.stableToken &&
                !identity.hasProcessingSignal &&
                !identity.hasFailureSignal
            );
        }

        function isFreshRowCacheEntryMatch(sourceData, cacheEntry) {
            if (!sourceData || !cacheEntry || !cacheEntry.row) return false;
            const doc = getDocument();
            if (!doc?.body || !doc.body.contains(cacheEntry.row)) return false;

            const rowIdentity = cacheEntry.identity || extractSourceIdentitySnapshot(cacheEntry.row);
            if (!rowIdentity) return false;

            if (sourceData.stableToken) {
                return Boolean(rowIdentity.stableToken && rowIdentity.stableToken === sourceData.stableToken);
            }

            if (!sourceData.fingerprint) return false;
            return rowIdentity.fingerprint === sourceData.fingerprint;
        }

        function resolveFreshRowEntry(sourceKey) {
            const sourceData = getSourcesByKey().get(sourceKey);
            if (!sourceData) return null;

            let freshRowCache = getFreshRowCache();
            if (!freshRowCache) {
                freshRowCache = new Map();
                setFreshRowCache(freshRowCache);
            }

            const cachedEntry = freshRowCache.get(sourceKey);
            if (isFreshRowCacheEntryMatch(sourceData, cachedEntry)) {
                return cachedEntry;
            }

            freshRowCache.delete(sourceKey);

            const sourcePanel = findSourcePanel();
            const sourceRoot = sourcePanel || getDocument();
            const sourceEntries = getSourceEntries(sourceRoot);
            const sourceElements = sourceEntries.map((entry) => entry.row);
            const stableTokenMatches = [];
            const fingerprintMatches = [];
            const depsConfig = getDEPS();

            for (const row of sourceElements) {
                const rowIdentity = extractSourceIdentitySnapshot(row);
                if (!rowIdentity) continue;

                if (Boolean(
                    sourceData.stableToken &&
                    rowIdentity.stableToken &&
                    rowIdentity.stableToken === sourceData.stableToken
                )) {
                    stableTokenMatches.push({
                        row,
                        checkbox: findElement(depsConfig.checkbox, row),
                        identity: rowIdentity,
                        nativeLabelTitle: sourceEntries.find((entry) => entry.row === row)?.nativeLabelTitle || ''
                    });
                }

                if (Boolean(
                    sourceData.fingerprint &&
                    rowIdentity.fingerprint === sourceData.fingerprint
                )) {
                    fingerprintMatches.push({
                        row,
                        checkbox: findElement(depsConfig.checkbox, row),
                        identity: rowIdentity,
                        nativeLabelTitle: sourceEntries.find((entry) => entry.row === row)?.nativeLabelTitle || ''
                    });
                }
            }

            let resolvedEntry = null;
            if (stableTokenMatches.length === 1) {
                [resolvedEntry] = stableTokenMatches;
            } else if (stableTokenMatches.length === 0 && fingerprintMatches.length === 1) {
                [resolvedEntry] = fingerprintMatches;
            }

            if (!resolvedEntry) {
                return null;
            }

            freshRowCache.set(sourceKey, resolvedEntry);
            return resolvedEntry;
        }

        function findFreshCheckbox(sourceKey) {
            const resolvedEntry = resolveFreshRowEntry(sourceKey);
            return resolvedEntry ? resolvedEntry.checkbox : null;
        }

        function getSourceElements(parent = getDocument()) {
            return getSourceEntries(parent).map((entry) => entry.row);
        }

        function getManageableSourceElements(parent = getDocument()) {
            return getSourceElements(parent).filter((row) => isManageableSourceIdentity(extractSourceIdentitySnapshot(row)));
        }

        function hasRenderableSourceRows(parent = getDocument()) {
            return getManageableSourceElements(parent).length > 0;
        }

        function getSourcePanelState(panel) {
            const sourcePanel = panel || findSourcePanel();
            if (!sourcePanel) {
                return {
                    state: 'missing',
                    totalRows: 0,
                    manageableRows: 0,
                    detailLikeRows: 0,
                    loadingRows: 0
                };
            }

            if (!isSourcePanelRenderable(sourcePanel)) {
                return {
                    state: 'collapsed',
                    totalRows: 0,
                    manageableRows: 0,
                    detailLikeRows: 0,
                    loadingRows: 0
                };
            }

            const sourceElements = getSourceElements(sourcePanel);
            const hasNativeDetailView = hasNativeSourceDetailView(sourcePanel);
            if (sourceElements.length === 0) {
                if (hasNativeDetailView || (getSourceDetailViewRequested() && hasPreservableManagerSnapshot())) {
                    return {
                        state: 'detail',
                        totalRows: 0,
                        manageableRows: 0,
                        detailLikeRows: 0,
                        loadingRows: 0
                    };
                }

                if (
                    hasPreservableManagerSnapshot() ||
                    getPendingInitialLoadedState() ||
                    getIsAwaitingInitialStateLoad()
                ) {
                    return {
                        state: 'loading',
                        totalRows: 0,
                        manageableRows: 0,
                        detailLikeRows: 0,
                        loadingRows: 0
                    };
                }

                return {
                    state: 'ready',
                    totalRows: 0,
                    manageableRows: 0,
                    detailLikeRows: 0,
                    loadingRows: 0
                };
            }

            let manageableRows = 0;
            let detailLikeRows = 0;
            let loadingRows = 0;
            let failedRows = 0;

            sourceElements.forEach((row) => {
                const identity = extractSourceIdentitySnapshot(row);
                if (isManageableSourceIdentity(identity)) {
                    manageableRows += 1;
                }
                if (isDetailLikeSourceIdentity(identity)) {
                    detailLikeRows += 1;
                }
                if (hasSourceLoadingIndicator(row)) {
                    loadingRows += 1;
                }
                if (identity?.hasFailureSignal) {
                    failedRows += 1;
                }
            });

            if (hasNativeDetailView) {
                return {
                    state: 'detail',
                    totalRows: sourceElements.length,
                    manageableRows,
                    detailLikeRows,
                    loadingRows,
                    failedRows
                };
            }

            if (manageableRows === sourceElements.length) {
                if (isSuppressingReadyStateForSourceDetail() && hasPreservableManagerSnapshot()) {
                    return {
                        state: 'detail',
                        totalRows: sourceElements.length,
                        manageableRows,
                        detailLikeRows,
                        loadingRows,
                        failedRows
                    };
                }

                if (getSourceDetailViewRequested()) {
                    setSourceDetailViewRequested(false);
                }
                runtime.sourceDetailViewReadySuppressionUntil = 0;
                return {
                    state: 'ready',
                    totalRows: sourceElements.length,
                    manageableRows,
                    detailLikeRows,
                    loadingRows,
                    failedRows
                };
            }

            if (
                loadingRows === 0 &&
                (
                    (getSourceDetailViewRequested() && hasPreservableManagerSnapshot()) ||
                    (hasPreservableManagerSnapshot() && detailLikeRows === sourceElements.length)
                )
            ) {
                return {
                    state: 'detail',
                    totalRows: sourceElements.length,
                    manageableRows,
                    detailLikeRows,
                    loadingRows,
                    failedRows
                };
            }

            return {
                state: 'loading',
                totalRows: sourceElements.length,
                manageableRows,
                detailLikeRows,
                loadingRows,
                failedRows
            };
        }

        function isSourcePanelManageable(panel) {
            return getSourcePanelState(panel).state === 'ready';
        }

        function isSourceDetailViewPanel(panel) {
            return getSourcePanelState(panel).state === 'detail';
        }

        function shouldPreserveExistingSourcesDuringPartialSync(currentSources, sourceLookup, previousSourceRecordsByKey) {
            if (!previousSourceRecordsByKey || typeof previousSourceRecordsByKey.forEach !== 'function') return false;
            const previousCount = previousSourceRecordsByKey.size;
            const currentCount = Array.isArray(currentSources) ? currentSources.length : 0;
            if (previousCount === 0 || currentCount >= previousCount) return false;
            if (currentCount === 0) return true;

            const currentKeys = new Set((currentSources || []).map((source) => source.key).filter(Boolean));
            if (currentKeys.size === 0) return true;

            const missingPreviousKeys = [];
            previousSourceRecordsByKey.forEach((sourceRecord, storedKey) => {
                const resolution = resolveStoredSourceKeyWithReason(storedKey, sourceLookup, sourceRecord);
                if (!resolution?.key || !currentKeys.has(resolution.key)) {
                    missingPreviousKeys.push(resolution?.key || storedKey);
                }
            });

            if (missingPreviousKeys.length === 0) return false;

            const recentNativeDeletedSourceKeys = runtime.recentNativeDeletedSourceKeys instanceof Set
                ? runtime.recentNativeDeletedSourceKeys
                : null;
            if (
                recentNativeDeletedSourceKeys &&
                missingPreviousKeys.every((key) => recentNativeDeletedSourceKeys.has(key))
            ) {
                missingPreviousKeys.forEach((key) => recentNativeDeletedSourceKeys.delete(key));
                return false;
            }

            return true;
        }

        function scanAndSyncSources(loadedState, isFirstLoad = false) {
            const sourcesByKey = getSourcesByKey();
            const sourceTagsById = getSourceTagsById();
            const groupsById = getGroupsById();
            const keyByElement = new WeakMap();
            const state = getState();
            const oldSourcesMap = new Map();
            const oldSourceTags = new Map();
            const previousSourceRecordsByKey = !isFirstLoad ? snapshotExistingSourceRecords() : new Map();

            if (!isFirstLoad) {
                sourcesByKey.forEach((source, key) => {
                    oldSourcesMap.set(key, { enabled: source.enabled });
                });
                sourceTagsById.forEach((tagIds, key) => {
                    oldSourceTags.set(key, [...tagIds]);
                });
            }

            const sourcePanel = findSourcePanel();
            const sourceRoot = sourcePanel || getDocument();
            const sourceEntries = getSourceEntries(sourceRoot);
            const sourceElements = sourceEntries.map((entry) => entry.row);
            if (sourceElements.length === 0 && Array.from(getDocument()?.body?.children || []).length > 2) {
                // The native panel can be empty while NotebookLM is still loading initial results.
            }

            const seenSourceIds = new Map();
            const seenLegacyKeys = new Map();
            const currentSources = sourceEntries
                .map((entry) => {
                    const descriptor = createSourceDescriptor(entry.row, seenSourceIds, seenLegacyKeys);
                    if (!descriptor) return null;
                    return Object.assign(descriptor, {
                        sourceViewKind: entry.viewKind || (runtime.sourceViewKind || SOURCE_VIEW_KIND_UNKNOWN),
                        nativeLabelTitle: entry.nativeLabelTitle || ''
                    });
                })
                .filter(Boolean);
            const sourceLookup = buildSourceLookup(currentSources);
            if (!isFirstLoad && shouldPreserveExistingSourcesDuringPartialSync(currentSources, sourceLookup, previousSourceRecordsByKey)) {
                runtime.lastSkippedPartialSourceSync = {
                    previousCount: previousSourceRecordsByKey.size,
                    currentCount: currentSources.length,
                    skippedAt: new Date().toISOString()
                };
                return false;
            }

            sourcesByKey.clear();
            sourceTagsById.clear();
            runtime.keyByElement = keyByElement;

            const normalizedTagState = isFirstLoad ? buildNormalizedTagState(loadedState) : null;
            const resolvedSourceStateById = isFirstLoad
                ? buildResolvedSourceStateById(sourceLookup, loadedState)
                : new Map();
            const resolvedSourceTagsById = isFirstLoad
                ? buildResolvedSourceTagsById(sourceLookup, loadedState, normalizedTagState?.rawToSafeTagId || null)
                : new Map();

            if (isFirstLoad && normalizedTagState) {
                const tagsById = runtime.tagsById instanceof Map ? runtime.tagsById : ensureMap('tagsById');
                tagsById.clear();
                normalizedTagState.nextTagsById.forEach((tag, tagId) => {
                    tagsById.set(tagId, tag);
                });
                state.tagOrder = normalizedTagState.nextTagOrder;
            }

            let knownSourceRefs = new Set();
            if (isFirstLoad) {
                const reconciledTree = reconcilePersistedTree(loadedState, sourceLookup);
                state.groups = reconciledTree.groups;
                state.ungrouped = reconciledTree.ungrouped;
                groupsById.clear();
                reconciledTree.groupsById.forEach((group, groupId) => {
                    groupsById.set(groupId, group);
                });
                knownSourceRefs = reconciledTree.seenSourceRefs;
            } else {
                const remappedState = remapExistingStateToCurrentSources(sourceLookup, {
                    sourceRecordsByKey: previousSourceRecordsByKey,
                    sourceTagsById: oldSourceTags
                });
                state.groups = remappedState.groups;
                state.ungrouped = remappedState.ungrouped;
                groupsById.clear();
                remappedState.groupsById.forEach((group, groupId) => {
                    groupsById.set(groupId, group);
                });
                oldSourcesMap.clear();
                remappedState.sourceStateById.forEach((sourceRecord, sourceKey) => {
                    oldSourcesMap.set(sourceKey, { enabled: Boolean(sourceRecord.enabled) });
                });
                oldSourceTags.clear();
                remappedState.sourceTagsById.forEach((tagIds, sourceKey) => {
                    oldSourceTags.set(sourceKey, [...tagIds]);
                });
                knownSourceRefs = remappedState.seenSourceRefs;
            }

            currentSources.forEach((source) => {
                let enabled;
                if (isFirstLoad) {
                    enabled = resolvedSourceStateById.has(source.key)
                        ? Boolean(resolvedSourceStateById.get(source.key).enabled)
                        : (source.hasNativeCheckbox ? Boolean(source.checkbox?.checked) : true);
                } else {
                    enabled = oldSourcesMap.has(source.key)
                        ? Boolean(oldSourcesMap.get(source.key).enabled)
                        : (source.hasNativeCheckbox ? Boolean(source.checkbox?.checked) : true);
                }

                const hydratedSource = {
                    ...source,
                    enabled
                };

                sourcesByKey.set(source.key, hydratedSource);
                keyByElement.set(source.element, source.key);
                setSourceTagIds(
                    source.key,
                    isFirstLoad
                        ? (resolvedSourceTagsById.get(source.key) || [])
                        : (oldSourceTags.get(source.key) || [])
                );

                if (!knownSourceRefs.has(source.key)) {
                    state.ungrouped.push(source.key);
                    knownSourceRefs.add(source.key);
                }
            });

            if (state.activeTagId && !(runtime.tagsById instanceof Map ? runtime.tagsById : ensureMap('tagsById')).has(state.activeTagId)) {
                state.activeTagId = null;
            }

            buildParentMap();
            sourcesByKey.forEach((source) => {
                syncSourceToPage(source, isSourceEffectivelyEnabled(source));
            });

            return isFirstLoad && getPendingStorageUpgrade();
        }

        const createDebounced = typeof debounceFn === 'function'
            ? debounceFn
            : ((func) => {
                const wrapped = function (...args) {
                    return func.apply(this, args);
                };
                wrapped.flush = () => false;
                wrapped.cancel = () => {};
                wrapped.isPending = () => false;
                return wrapped;
            });

        const debouncedScanAndSync = createDebounced((syncOptions = {}) => {
            try {
                if (getIsAwaitingInitialStateLoad()) {
                    return;
                }

                const sourcePanel = findSourcePanel();
                const panelState = getSourcePanelState(sourcePanel);

                if (panelState.state === 'detail') {
                    if (getExtensionHost() || getShadowRoot() || getScrollObserver()) {
                        suspendManagerForSourceDetailView();
                    } else {
                        runtime.managerStatusReason = 'source_detail_view';
                    }
                    return;
                }

                if (panelState.state !== 'ready') {
                    return;
                }

                const pendingInitialLoadedState = getPendingInitialLoadedState();
                if (pendingInitialLoadedState) {
                    const pendingRestore = flushPendingInitialLoadedState();
                    if (pendingRestore.deferred) {
                        return;
                    }

                    render();
                    if (pendingRestore.shouldUpgradeStorage) {
                        setPendingStorageUpgrade(false);
                        saveState();
                    }
                    return;
                }

                const previousPersistableSignature = getPersistableStateSignature();
                // Pass false for isFirstLoad because this is triggered by DOM mutations
                scanAndSyncSources({}, false);
                render();
                const nextPersistableSignature = getPersistableStateSignature();
                if (shouldSaveAfterMutationSync(previousPersistableSignature, nextPersistableSignature)) {
                    saveState(syncOptions?.critical
                        ? { immediate: true, critical: true }
                        : {});
                }
            } catch (error) {
                console.error('NotebookLM Source Management: Error syncing state during DOM change.', error);
            }
        }, 500);

        function isElementInsideExtensionRoot(element) {
            if (!element || element.nodeType !== 1) return false;
            return Boolean(
                element.id === 'sources-plus-root' ||
                element.closest?.('#sources-plus-root')
            );
        }

        function getMutationElementTarget(target) {
            if (!target) return null;
            if (target.nodeType === 1) return target;
            return target.parentElement || target.parentNode || null;
        }

        function isElementWithinSourceRow(element) {
            if (!element || element.nodeType !== 1) return false;
            const configuredRowSelectors = Array.isArray(getDEPS().row) ? getDEPS().row : [];
            const rowSelectors = [...configuredRowSelectors, ...LABEL_SOURCE_ROW_SELECTORS];
            return rowSelectors.some((selector) => {
                try {
                    return Boolean(element.matches?.(selector) || element.closest?.(selector));
                } catch (error) {
                    return false;
                }
            });
        }

        function isRelevantSourceChildNode(node) {
            if (!node) return false;
            if (node.nodeType === 3) {
                return isElementWithinSourceRow(getMutationElementTarget(node));
            }
            if (node.nodeType !== 1) return false;
            return Boolean(
                node.hasAttribute?.('data-testid') ||
                node.classList?.contains('single-source-container') ||
                node.querySelector?.('.single-source-container') ||
                isElementWithinSourceRow(node)
            );
        }

        function getMutationRelevance(mutation) {
            const targetElement = getMutationElementTarget(mutation?.target);
            if (isElementInsideExtensionRoot(targetElement)) {
                return { relevant: false, critical: false };
            }

            if (mutation?.type === 'childList') {
                const changedNodes = [
                    ...Array.from(mutation.addedNodes || []),
                    ...Array.from(mutation.removedNodes || [])
                ];
                const relevant = changedNodes.some((node) => isRelevantSourceChildNode(node));
                return { relevant, critical: false };
            }

            if (mutation?.type === 'characterData') {
                return {
                    relevant: isElementWithinSourceRow(targetElement),
                    critical: true
                };
            }

            if (mutation?.type === 'attributes') {
                const attributeName = String(mutation.attributeName || '');
                return {
                    relevant: SOURCE_RENAME_ATTRIBUTE_NAMES.has(attributeName) && isElementWithinSourceRow(targetElement),
                    critical: true
                };
            }

            return { relevant: false, critical: false };
        }

        function handleDomChanges(mutations) {
            try {
                let needsReSync = false;
                let needsCriticalSave = false;
                for (const mutation of mutations) {
                    const relevance = getMutationRelevance(mutation);
                    if (relevance.relevant) {
                        needsReSync = true;
                        needsCriticalSave = needsCriticalSave || relevance.critical;
                        if (needsCriticalSave) break;
                    }
                }

                if (needsReSync) {
                    setFreshRowCache(null);
                    debouncedScanAndSync(needsCriticalSave ? { critical: true } : {});
                }
            } catch (error) {
                console.error('NotebookLM Source Management: Failed handling mutations.', error);
            }
        }

        return {
            isFreshRowCacheEntryMatch,
            resolveFreshRowEntry,
            findFreshCheckbox,
            getSourceViewInfo,
            detectSourceView,
            getSourceEntries,
            getSourceElements,
            getManageableSourceElements,
            hasRenderableSourceRows,
            hasSourceLoadingIndicator,
            isDetailLikeSourceIdentity,
            hasNativeSourceDetailView,
            getSourcePanelState,
            isSourcePanelManageable,
            isSourceDetailViewPanel,
            scanAndSyncSources,
            handleDomChanges,
            debouncedScanAndSync,
            getPersistableStateSignature,
            shouldSaveAfterMutationSync,
            getMutationRelevance,
            getFreshRowCache,
            setFreshRowCache,
            clearFreshRowCache: () => setFreshRowCache(null)
        };
    }

    globalThis.NSM_CREATE_CONTENT_SOURCE_SYNC = createContentSourceSync;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentSourceSync;
    }
})();
