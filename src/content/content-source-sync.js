(function () {
    'use strict';

    /**
     * createContentSourceSync(deps) — 源扫描 + state 同步主控。
     * 把 NotebookLM 原生 DOM (list view / label view / 折叠 label group / loading 行 / failed 行)
     * 扫描成 source descriptor,再 reconcile 进 state.groups + state.ungrouped + sourcesByKey,
     * 处理 SPA 切换 + 半截扫描 + native delete/rename 后的事后同步。MutationObserver 入口。
     *
     * @param {Object} deps 60+ 项依赖,大致四类(完整 destructuring 见 line 4+):
     *   - 环境: runtime, getDocument / getWindow / getDEPS, findElement, findSourcePanel,
     *     isSourcePanelRenderable
     *   - 扫描/识别: createSourceDescriptor, extractSourceIdentitySnapshot,
     *     isManageableSourceIdentity, hasPreservableManagerSnapshot,
     *     isSourceEffectivelyEnabled
     *   - state reconcile: reconcilePersistedTree, snapshotExistingSourceRecords,
     *     remapExistingStateToCurrentSources, buildSourceLookup,
     *     resolveStoredSourceKeyWithReason, buildResolvedSourceStateById,
     *     buildNormalizedTagState, buildResolvedSourceTagsById, buildParentMap,
     *     buildPersistableState, setSourceTagIds, syncSourceToPage, saveState
     *   - 日志/i18n: developerLog
     * @returns {Object} 30+ helpers。主要入口 `scanAndSyncSources` / `handleDomChanges` /
     *   `debouncedScanAndSync`;此外暴露 fresh-row cache (findFreshCheckbox /
     *   resolveFreshRowEntry / getFreshRowCache / setFreshRowCache / clearFreshRowCache),
     *   source-view 检测 (detectSourceView / getSourceViewInfo),
     *   折叠 label group 控制 (getCollapsedNativeLabel* / expandCollapsedNativeLabelGroups /
     *   restoreNativeLabelExpansionControls),以及 panel 状态判定与 signature 比对。
     *   完整 return 块见 line 2599。
     */
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
        const developerLog = typeof deps.developerLog === 'function'
            ? deps.developerLog
            : () => false;
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
        const createContentSourceListScan = typeof deps.createContentSourceListScan === 'function'
            ? deps.createContentSourceListScan
            : globalThis.NSM_CREATE_CONTENT_SOURCE_LIST_SCAN;
        const createContentNativeLabelScan = typeof deps.createContentNativeLabelScan === 'function'
            ? deps.createContentNativeLabelScan
            : globalThis.NSM_CREATE_CONTENT_NATIVE_LABEL_SCAN;
        const createContentSourcePartialSyncGuard = typeof deps.createContentSourcePartialSyncGuard === 'function'
            ? deps.createContentSourcePartialSyncGuard
            : globalThis.NSM_CREATE_CONTENT_SOURCE_PARTIAL_SYNC_GUARD;
        const sourceListScan = typeof createContentSourceListScan === 'function'
            ? createContentSourceListScan()
            : {};
        const nativeLabelScan = typeof createContentNativeLabelScan === 'function'
            ? createContentNativeLabelScan()
            : {};
        const sourcePartialSyncGuard = typeof createContentSourcePartialSyncGuard === 'function'
            ? createContentSourcePartialSyncGuard({
                resolveStoredSourceKeyWithReason
            })
            : {};
        const getNativeCheckboxState = typeof sourceListScan.getNativeCheckboxState === 'function'
            ? sourceListScan.getNativeCheckboxState
            : () => null;
        const getNativeSourceCheckboxState = typeof sourceListScan.getNativeSourceCheckboxState === 'function'
            ? sourceListScan.getNativeSourceCheckboxState
            : (source, fallbackState = true) => (source?.hasNativeCheckbox ? Boolean(fallbackState) : true);
        const parseNativeLabelSourceCount = typeof nativeLabelScan.parseNativeLabelSourceCount === 'function'
            ? nativeLabelScan.parseNativeLabelSourceCount
            : () => null;
        const partialSyncHasPreviousRecord = typeof sourcePartialSyncGuard.hasPreviousRecordForCurrentSource === 'function'
            ? sourcePartialSyncGuard.hasPreviousRecordForCurrentSource
            : () => false;
        const partialSyncShouldPreserveExistingSources = typeof sourcePartialSyncGuard.shouldPreserveExistingSourcesDuringPartialSync === 'function'
            ? sourcePartialSyncGuard.shouldPreserveExistingSourcesDuringPartialSync
            : () => false;
        const partialSyncMarkTransientRawUrlImportSources = typeof sourcePartialSyncGuard.markTransientRawUrlImportSources === 'function'
            ? sourcePartialSyncGuard.markTransientRawUrlImportSources
            : () => 0;

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
            'mat-accordion',
            'mat-expansion-panel',
            'mat-tree-node',
            '[role="treeitem"]',
            '.source-label',
            '.source-label-group',
            '.source-group',
            '.label-group',
            '.mat-accordion',
            '.mat-expansion-panel',
            '.mat-tree-node'
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
            '[role="listitem"]',
            'mat-list-item',
            '.mat-list-item',
            '.mat-mdc-list-item',
            '[data-source-id]',
            '[data-document-id]',
            '[data-doc-id]',
            '[data-file-id]',
            '[data-drive-id]',
            '[data-resource-id]'
        ];
        const LABEL_HEADER_TITLE_SELECTORS = [
            '[data-testid*="label-title" i]',
            '[data-testid*="group-title" i]',
            '[data-testid*="category-title" i]',
            '.source-label-title',
            '.label-title',
            '.group-title',
            '.mat-expansion-panel-header-title',
            '.mat-content',
            'button',
            '[role="button"]',
            'mat-tree-node',
            '.mat-tree-node',
            '[role="treeitem"]',
            '[aria-expanded]',
            'button[aria-expanded]',
            '[role="button"][aria-expanded]',
            '[role="heading"]',
            'h1',
            'h2',
            'h3',
            'h4',
            'h5',
            'h6'
        ];
        const LABEL_EXPANSION_CONTROL_SELECTORS = [
            'button[aria-expanded]',
            '[role="button"][aria-expanded]',
            '[aria-expanded]',
            'button',
            '[role="button"]',
            '[role="treeitem"]',
            'mat-expansion-panel-header',
            'mat-tree-node',
            '.mat-tree-node',
            '.mat-expansion-panel-header',
            '.source-label-title',
            'mat-icon',
            '.mat-icon',
            '.google-symbols',
            ...LABEL_GROUP_SELECTORS
        ];
        const LABEL_VIEW_TEXT_PATTERN = /\b(label|labels|categor(?:y|ies|ize)|group|groups)\b|标签|分类|分组/i;
        const COLLAPSED_NATIVE_LABEL_ICON_PATTERN = /\b(?:keyboard_arrow_right|chevron_right|arrow_right|navigate_next)\b|(?:^|\s)[>›▸](?:\s|$)/i;
        const GENERIC_NATIVE_CONTROL_TITLE_PATTERN = /^(?:more|more options?|options?|menu|overflow|ellipsis|kebab|actions?|更多|更多选项|更多操作|选项|選項|菜单|菜單|操作)$/i;
        const SOURCE_STATUS_ATTRIBUTE_NAMES = new Set([
            'aria-busy',
            'aria-live',
            'role',
            'data-state',
            'data-status'
        ]);
        const MANAGER_ACTIVE_CLASS = 'sources-plus-manager-active';
        const NATIVE_SOURCE_LIST_CONTAINER_SELECTORS = [
            '.scroll-area-desktop',
            '.sources-list-container',
            '[data-testid="scroll-area"]',
            '.source-label-group',
            'mat-accordion',
            'mat-expansion-panel',
            '.mat-accordion',
            '.mat-expansion-panel',
            '[data-testid="source-label-group"]',
            '[data-testid*="label-group" i]',
            '[data-testid*="source-group" i]',
            '[data-testid*="category-group" i]',
            '[data-testid*="source-category" i]'
        ];

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

        function queryDescendantElements(root, selectors) {
            if (!root || typeof root.querySelectorAll !== 'function') return [];
            const matchedElements = [];
            const seenElements = new Set();
            for (const selector of selectors) {
                try {
                    Array.from(root.querySelectorAll(selector)).forEach((element) => {
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

        const createContentNativeLabelDetectorFactory = globalThis.NSM_CREATE_CONTENT_NATIVE_LABEL_DETECTOR;
        if (typeof createContentNativeLabelDetectorFactory !== 'function') {
            throw new Error('NotebookLM Source Management: createContentSourceSync requires NSM_CREATE_CONTENT_NATIVE_LABEL_DETECTOR to be loaded first.');
        }
        const {
            ACTIVE_LABEL_VIEW_CONTROL_PATTERN,
            SELECT_ALL_TEXT_PATTERN,
            NATIVE_SOURCE_CONTROL_TEXT_PATTERN,
            cleanAccessibleLabelTitle,
            cleanNativeLabelTitleCandidate,
            getComparableNativeLabelTitle,
            isLikelyNativeLabelTitle,
            isNativeLabelEntryPointControl,
            isNativeSourceViewSwitchControl
        } = createContentNativeLabelDetectorFactory({ getAttributeValue, getElementTextSignal });


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

            const titleElement = typeof element.querySelector === 'function'
                ? findElement(LABEL_TITLE_SELECTORS, element)
                : null;
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

        function elementContains(parent, child) {
            if (!parent || !child) return false;
            if (parent === child) return true;
            if (typeof parent.contains === 'function') {
                try {
                    return Boolean(parent.contains(child));
                } catch (error) {
                    // Some mocked nodes do not implement native contains semantics.
                }
            }

            let cursor = getParentElement(child);
            let depth = 0;
            while (cursor && depth < 32) {
                if (cursor === parent) return true;
                cursor = getParentElement(cursor);
                depth += 1;
            }
            return false;
        }

        function compareElementsInDocumentOrder(left, right) {
            if (!left || !right || left === right || typeof left.compareDocumentPosition !== 'function') return 0;
            try {
                const position = left.compareDocumentPosition(right);
                if (position & 4) return -1;
                if (position & 2) return 1;
            } catch (error) {
                return 0;
            }
            return 0;
        }

        function sortElementsInDocumentOrder(entries) {
            return entries.slice().sort((left, right) => {
                const relation = compareElementsInDocumentOrder(left.element, right.element);
                return relation || 0;
            });
        }

        function isLikelySourceRowElement(element) {
            if (!element) return false;
            return elementMatchesAny(element, LABEL_SOURCE_ROW_SELECTORS);
        }

        function isInsideNativeSourceRowElement(element, boundary = null) {
            if (!element) return false;
            let cursor = element;
            let depth = 0;
            while (cursor && depth < 24) {
                if (cursor !== boundary && isLikelySourceRowElement(cursor)) return true;
                if (boundary && cursor === boundary) break;
                cursor = getParentElement(cursor);
                depth += 1;
            }
            return false;
        }

        function isInsideNativeLabelGroupElement(element, boundary = null) {
            if (!element) return false;
            let cursor = getParentElement(element);
            let depth = 0;
            while (cursor && depth < 24) {
                if (boundary && cursor === boundary) break;
                if (elementMatchesAny(cursor, LABEL_GROUP_SELECTORS)) return true;
                cursor = getParentElement(cursor);
                depth += 1;
            }
            return false;
        }

        function isGenericNativeControlTitleElement(element, title) {
            if (!GENERIC_NATIVE_CONTROL_TITLE_PATTERN.test(String(title || '').trim())) return false;
            const tagName = String(element?.tagName || '').toLowerCase();
            const role = getAttributeValue(element, 'role').toLowerCase();
            const identityText = [
                getAttributeValue(element, 'aria-label'),
                getAttributeValue(element, 'title'),
                getAttributeValue(element, 'data-testid'),
                getAttributeValue(element, 'class'),
                String(element?.className || '')
            ].filter(Boolean).join(' ');
            return (
                tagName === 'button' ||
                ['button', 'menuitem', 'menuitemradio', 'menuitemcheckbox'].includes(role) ||
                Boolean(getAttributeValue(element, 'aria-haspopup')) ||
                Boolean(getAttributeValue(element, 'aria-expanded')) ||
                /\b(more|options?|menu|overflow|ellipsis|kebab|actions?)\b|更多|选项|選項|菜单|菜單|操作/i.test(identityText)
            );
        }

        function getPreviousSibling(element) {
            return element?.previousElementSibling || element?.previousSibling || null;
        }

        function isNativeLabelHeaderElement(element) {
            if (!element) return false;
            if (isInsideNativeSourceRowElement(element)) return false;
            if (isNativeSourceViewSwitchControl(element)) return false;
            if (isNativeLabelEntryPointControl(element)) return false;
            const tagName = String(element.tagName || '').toLowerCase();
            const role = getAttributeValue(element, 'role').toLowerCase();
            const ariaExpanded = getAttributeValue(element, 'aria-expanded');
            const className = String(element.className || '');
            const testId = getAttributeValue(element, 'data-testid');
            if (ariaExpanded) return true;
            if (role === 'heading') return true;
            if (/^h[1-6]$/.test(tagName)) return true;
            if (elementMatchesAny(element, LABEL_GROUP_SELECTORS)) return true;
            if ((tagName === 'button' || role === 'button' || role === 'treeitem') && isLikelyNativeLabelTitle(getElementTextSignal(element))) {
                const checkbox = typeof element.querySelector === 'function'
                    ? element.querySelector('input[type="checkbox"], [role="checkbox"], mat-checkbox, .mat-checkbox, .mat-mdc-checkbox, .mdc-checkbox')
                    : null;
                if (checkbox) return true;
            }
            return /(label|group|category|folder|header|title|expansion-panel)/i.test(`${className} ${testId}`);
        }

        function getNativeLabelTitleFromCandidate(element, row, panel, options = {}, rowIdentity = null) {
            if (!element || element === row || elementContains(element, row)) return '';
            if (isInsideNativeSourceRowElement(element, panel)) return '';
            if (isNativeSourceViewSwitchControl(element)) return '';
            if (isNativeLabelEntryPointControl(element)) return '';
            if (isHiddenForNativeLabelRowScan(element, panel, options)) return '';

            const candidates = [
                element.dataset?.sourceLabel,
                element.dataset?.labelTitle,
                getAttributeValue(element, 'data-source-label'),
                getAttributeValue(element, 'data-label-title'),
                getAttributeValue(element, 'data-label'),
                getAttributeValue(element, 'aria-label'),
                getAttributeValue(element, 'title'),
                typeof element.textContent === 'string' ? element.textContent : ''
            ].filter(Boolean);

            for (const candidate of candidates) {
                const title = cleanNativeLabelTitleCandidate(candidate);
                if (isGenericNativeControlTitleElement(element, title)) continue;
                if (isLikelyNativeLabelTitle(title, rowIdentity)) return title;
            }

            return '';
        }

        function getNativeLabelHeaderEntries(panel, options = {}, rowIdentity = null) {
            const sourcePanel = panel || findSourcePanel();
            if (!sourcePanel) return [];
            const candidates = queryPanelElements(sourcePanel, LABEL_HEADER_TITLE_SELECTORS);
            const seen = new Set();
            const entries = [];
            candidates.forEach((candidate) => {
                if (!candidate || seen.has(candidate)) return;
                seen.add(candidate);
                if (!isNativeLabelHeaderElement(candidate)) return;
                const title = getNativeLabelTitleFromCandidate(candidate, null, sourcePanel, options, rowIdentity);
                if (!title) return;
                entries.push({ element: candidate, title });
            });
            return sortElementsInDocumentOrder(entries);
        }

        function findNearestPrecedingNativeLabelHeaderTitle(row, panel, options = {}, rowIdentity = null) {
            if (!row || !panel || typeof row.compareDocumentPosition !== 'function') return '';
            const headerEntries = getNativeLabelHeaderEntries(panel, options, rowIdentity);
            let best = null;
            headerEntries.forEach((entry) => {
                if (!entry?.element || entry.element === row || elementContains(row, entry.element)) return;
                if (elementContains(entry.element, row)) return;
                if (compareElementsInDocumentOrder(entry.element, row) < 0) {
                    best = entry;
                }
            });
            return best?.title || '';
        }

        function getNativeLabelTitleFromContainer(container, row, panel, options = {}, rowIdentity = null) {
            if (!container || container === panel || isHiddenForNativeLabelRowScan(container, panel, options)) return '';
            if (isLikelySourceRowElement(container)) return '';
            if (isNativeSourceViewSwitchControl(container)) return '';
            if (isNativeLabelEntryPointControl(container)) return '';

            if (elementMatchesAny(container, LABEL_GROUP_SELECTORS)) {
                const ownLabel = getElementOwnLabel(container);
                if (isLikelyNativeLabelTitle(ownLabel, rowIdentity)) {
                    return cleanNativeLabelTitleCandidate(ownLabel);
                }
            }

            const titleCandidates = queryDescendantElements(container, LABEL_HEADER_TITLE_SELECTORS);
            for (const candidate of titleCandidates) {
                if (isInsideNativeSourceRowElement(candidate, container)) continue;
                if (!isNativeLabelHeaderElement(candidate)) continue;
                const title = getNativeLabelTitleFromCandidate(candidate, row, panel, options, rowIdentity);
                if (title) return title;
            }

            return '';
        }

        function findPrecedingNativeLabelTitle(row, panel, options = {}, rowIdentity = null) {
            let cursor = row;
            let depth = 0;
            while (cursor && cursor !== panel && depth < 8) {
                let sibling = getPreviousSibling(cursor);
                let siblingDepth = 0;
                while (sibling && siblingDepth < 8) {
                    if (!isHiddenForNativeLabelRowScan(sibling, panel, options)) {
                        if (isNativeLabelHeaderElement(sibling)) {
                            const directTitle = getNativeLabelTitleFromCandidate(sibling, row, panel, options, rowIdentity);
                            if (directTitle) return directTitle;
                        }
                        const nestedTitle = getNativeLabelTitleFromContainer(sibling, row, panel, options, rowIdentity);
                        if (nestedTitle) return nestedTitle;
                    }
                    sibling = getPreviousSibling(sibling);
                    siblingDepth += 1;
                }
                cursor = getParentElement(cursor);
                depth += 1;
            }

            return '';
        }

        function isManagerSuppressionActive() {
            const root = getDocument()?.documentElement;
            if (!root) return false;
            if (typeof root.classList?.contains === 'function') {
                return root.classList.contains(MANAGER_ACTIVE_CLASS);
            }
            return String(root.className || '').split(/\s+/).includes(MANAGER_ACTIVE_CLASS);
        }

        function isElementInsideManagerSuppressedNativeArea(element, boundary = null) {
            if (!element || !isManagerSuppressionActive()) return false;

            let cursor = element;
            let depth = 0;
            while (cursor && depth < 24) {
                if (isManagerSuppressedNativeAreaElement(cursor)) {
                    return true;
                }
                if (boundary && cursor === boundary) break;
                cursor = getParentElement(cursor);
                depth += 1;
            }

            return false;
        }

        function isManagerSuppressedNativeAreaElement(element) {
            return Boolean(
                element &&
                isManagerSuppressionActive() &&
                elementMatchesAny(element, NATIVE_SOURCE_LIST_CONTAINER_SELECTORS)
            );
        }

        function shouldIgnoreHiddenStateFromManagerSuppression(element, boundary, options = {}) {
            return Boolean(
                options.ignoreManagerSuppression &&
                isElementInsideManagerSuppressedNativeArea(element, boundary)
            );
        }

        function shouldIncludeHiddenNativeLabelRows(options = {}) {
            return Boolean(options.includeHiddenNativeLabelRows || options.includeHiddenLabelRows);
        }

        function isHardHiddenForSourceScan(element, boundary = null) {
            if (!element) return true;
            if ('isConnected' in element && element.isConnected === false) return true;

            let cursor = element;
            let depth = 0;
            while (cursor && depth < 24) {
                if (cursor.hidden === true) return true;
                if (getAttributeValue(cursor, 'aria-hidden') === 'true') return true;
                if (boundary && cursor === boundary) break;
                cursor = getParentElement(cursor);
                depth += 1;
            }
            return false;
        }

        function hasNativeLabelHeaderNearCollapsedContent(element, boundary = null) {
            if (!element) return false;
            const previous = getPreviousSibling(element);
            if (previous && isNativeLabelHeaderElement(previous)) return true;

            let cursor = getParentElement(element);
            let depth = 0;
            while (cursor && depth < 6) {
                if (boundary && cursor === boundary) break;
                if (elementMatchesAny(cursor, LABEL_GROUP_SELECTORS)) {
                    const title = getNativeLabelGroupTitle(cursor, boundary, { ignoreManagerSuppression: true });
                    if (title) return true;
                    const header = typeof cursor.querySelector === 'function'
                        ? cursor.querySelector('mat-expansion-panel-header, .mat-expansion-panel-header, [aria-expanded], button, [role="button"], [role="treeitem"]')
                        : null;
                    if (header && isNativeLabelHeaderElement(header)) return true;
                }
                cursor = getParentElement(cursor);
                depth += 1;
            }
            return false;
        }

        function isCollapsedNativeLabelBodyElement(element, boundary = null) {
            if (!element) return false;
            const identity = [
                String(element.className || ''),
                getAttributeValue(element, 'data-testid'),
                getAttributeValue(element, 'role')
            ].filter(Boolean).join(' ');
            const hasBodySignal = (
                /\bmat-expansion-panel-(?:body|content|content-wrapper)\b/i.test(identity) ||
                /\b(?:label|source-label|category|group)[-_ ](?:body|content|children|items)\b/i.test(identity) ||
                /\b(?:body|content|children|items)[-_ ](?:label|source-label|category|group)\b/i.test(identity) ||
                /\b(mat-tree-node-children|cdk-tree-node-group)\b/i.test(identity) ||
                getAttributeValue(element, 'role').toLowerCase() === 'group' ||
                elementMatchesAny(element, [
                    '.mat-expansion-panel-body',
                    '.mat-expansion-panel-content',
                    '.mat-expansion-panel-content-wrapper',
                    '.mat-tree-node-children',
                    '[role="group"]'
                ])
            );
            return Boolean(hasBodySignal && hasNativeLabelHeaderNearCollapsedContent(element, boundary));
        }

        function isHiddenForNativeLabelRowScan(element, boundary = null, options = {}) {
            if (!shouldIncludeHiddenNativeLabelRows(options)) {
                return isNodeHiddenForSourceScan(element, boundary, options);
            }
            if (isHardHiddenForSourceScan(element, boundary)) return true;

            const win = getWindow();
            let cursor = element;
            let depth = 0;
            while (cursor && depth < 24) {
                const style = cursor.style || {};
                const styleHidden = (
                    style.display === 'none' ||
                    style.visibility === 'hidden' ||
                    style.visibility === 'collapse'
                );
                let computedHidden = false;
                try {
                    const computedStyle = typeof win?.getComputedStyle === 'function'
                        ? win.getComputedStyle(cursor)
                        : null;
                    computedHidden = Boolean(
                        computedStyle &&
                        (
                            computedStyle.display === 'none' ||
                            computedStyle.visibility === 'hidden' ||
                            computedStyle.visibility === 'collapse'
                        )
                    );
                } catch (error) {
                    computedHidden = false;
                }

                if (styleHidden || computedHidden) {
                    if (!isCollapsedNativeLabelBodyElement(cursor, boundary)) {
                        return true;
                    }
                }

                if (boundary && cursor === boundary) break;
                cursor = getParentElement(cursor);
                depth += 1;
            }
            return false;
        }

        function isNodeHiddenForSourceScan(element, boundary = null, options = {}) {
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
                    if (!(options.ignoreManagerSuppression && isManagerSuppressedNativeAreaElement(cursor))) {
                        return true;
                    }
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
                        if (!shouldIgnoreHiddenStateFromManagerSuppression(element, boundary, options)) {
                            return true;
                        }
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

        function findNativeLabelTitle(row, panel, options = {}) {
            if (!row) return '';
            if (typeof row.__nativeLabelTitle === 'string' && row.__nativeLabelTitle.trim()) {
                return row.__nativeLabelTitle.trim();
            }

            const rowIdentity = extractSourceIdentitySnapshot(row);
            const rowLabel = getElementOwnLabel(row);
            if (getAttributeValue(row, 'data-source-label') || getAttributeValue(row, 'data-label-title')) {
                return rowLabel;
            }

            let cursor = getParentElement(row);
            let depth = 0;
            while (cursor && cursor !== panel && depth < 8) {
                if (!isHiddenForNativeLabelRowScan(cursor, panel, options)) {
                    if (elementMatchesAny(cursor, LABEL_GROUP_SELECTORS)) {
                        const label = getElementOwnLabel(cursor);
                        if (label) return label;
                    }
                }
                cursor = getParentElement(cursor);
                depth += 1;
            }

            if (options.inferNativeLabelTitles) {
                const nearestHeaderTitle = findNearestPrecedingNativeLabelHeaderTitle(row, panel, options, rowIdentity);
                if (nearestHeaderTitle) return nearestHeaderTitle;
            }

            cursor = getParentElement(row);
            depth = 0;
            while (cursor && cursor !== panel && depth < 8) {
                if (!isHiddenForNativeLabelRowScan(cursor, panel, options) && options.inferNativeLabelTitles) {
                    const inferredLabel = getNativeLabelTitleFromContainer(cursor, row, panel, options, rowIdentity);
                    if (inferredLabel) return inferredLabel;
                }
                cursor = getParentElement(cursor);
                depth += 1;
            }

            return options.inferNativeLabelTitles
                ? findPrecedingNativeLabelTitle(row, panel, options, rowIdentity)
                : '';
        }

        function isActiveNativeLabelViewControl(element, panel, options = {}) {
            if (!element || isNodeHiddenForSourceScan(element, panel, options)) return false;
            if (isInsideNativeSourceRowElement(element, panel)) return false;
            if (isNativeLabelEntryPointControl(element)) return false;
            const text = getElementTextSignal(element);
            if (isGenericNativeControlTitleElement(element, cleanNativeLabelTitleCandidate(text))) return false;
            if (ACTIVE_LABEL_VIEW_CONTROL_PATTERN.test(text)) {
                return true;
            }

            if (
                getAttributeValue(element, 'aria-expanded') &&
                isLikelyNativeLabelTitle(text)
            ) {
                return true;
            }

            if (
                typeof element.querySelector === 'function' &&
                element.querySelector('input[type="checkbox"]') &&
                text &&
                !SELECT_ALL_TEXT_PATTERN.test(text) &&
                !NATIVE_SOURCE_CONTROL_TEXT_PATTERN.test(text)
            ) {
                return text.length <= 120;
            }

            return false;
        }

        function getActiveNativeLabelViewControls(panel, options = {}) {
            const controls = queryPanelElements(panel, ['button', '[role="button"]']);
            const seen = new Set();
            return controls.filter((control) => {
                if (!control || seen.has(control)) return false;
                seen.add(control);
                return isActiveNativeLabelViewControl(control, panel, options);
            });
        }

        function hasCollapsedNativeLabelIconSignal(element) {
            if (!element) return false;
            const textSignal = getElementTextSignal(element);
            const identitySignal = [
                getAttributeValue(element, 'data-testid'),
                getAttributeValue(element, 'class'),
                String(element.className || '')
            ].filter(Boolean).join(' ');
            return COLLAPSED_NATIVE_LABEL_ICON_PATTERN.test(`${textSignal} ${identitySignal}`);
        }

        function getNativeLabelExpansionTitle(element, panel, options = {}) {
            if (!element) return '';
            const directTitle = getNativeLabelTitleFromCandidate(element, null, panel, options);
            if (directTitle) return directTitle;
            const groupTitle = getNativeLabelGroupTitle(element, panel, options);
            if (groupTitle) return groupTitle;
            const textSignal = getElementTextSignal(element);
            const textTitle = cleanNativeLabelTitleCandidate(textSignal);
            return textTitle && isLikelyNativeLabelTitle(textSignal) ? textTitle : '';
        }

        function getNativeLabelExpansionExpectedSourceCount(element, panel) {
            if (!element) return null;
            const candidates = [];
            candidates.push(getElementTextSignal(element));
            let cursor = getParentElement(element);
            let depth = 0;
            while (cursor && cursor !== panel && depth < 4) {
                candidates.push(getElementTextSignal(cursor));
                cursor = getParentElement(cursor);
                depth += 1;
            }
            for (const candidate of candidates) {
                const count = parseNativeLabelSourceCount(candidate);
                if (count !== null) return count;
            }
            return null;
        }

        function isNativeLabelExpansionClickTargetCandidate(element, panel, options = {}) {
            if (!element) return false;
            if (isInsideNativeSourceRowElement(element, panel)) return false;
            if (isNativeSourceViewSwitchControl(element)) return false;
            if (isNativeLabelEntryPointControl(element)) return false;
            if (isNodeHiddenForSourceScan(element, panel, options)) return false;

            const tagName = String(element.tagName || '').toLowerCase();
            const role = getAttributeValue(element, 'role').toLowerCase();
            const isInteractiveHeader = (
                tagName === 'button' ||
                tagName === 'mat-tree-node' ||
                role === 'button' ||
                role === 'treeitem' ||
                isNativeLabelHeaderElement(element) ||
                elementMatchesAny(element, LABEL_GROUP_SELECTORS)
            );
            if (!isInteractiveHeader) return false;

            const textTitle = cleanNativeLabelTitleCandidate(getElementTextSignal(element));
            if (isGenericNativeControlTitleElement(element, textTitle)) return false;
            return Boolean(getNativeLabelExpansionTitle(element, panel, options));
        }

        function getNativeLabelExpansionClickTarget(control, panel, options = {}) {
            if (!control) return null;
            const descendants = queryDescendantElements(control, LABEL_EXPANSION_CONTROL_SELECTORS);
            const tagName = String(control.tagName || '').toLowerCase();
            const role = getAttributeValue(control, 'role').toLowerCase();
            const isContainerControl = elementMatchesAny(control, LABEL_GROUP_SELECTORS) &&
                tagName !== 'button' &&
                role !== 'button';
            const candidates = isContainerControl
                ? [...descendants, control]
                : [control, ...descendants];
            const seen = new Set();
            const uniqueCandidates = candidates.filter((candidate) => {
                if (!candidate || seen.has(candidate)) return false;
                seen.add(candidate);
                return isNativeLabelExpansionClickTargetCandidate(candidate, panel, options);
            });

            const directAriaExpanded = String(getAttributeValue(control, 'aria-expanded')).toLowerCase();
            if (
                directAriaExpanded === 'false' &&
                !isContainerControl &&
                !isInsideNativeSourceRowElement(control, panel) &&
                !isNativeSourceViewSwitchControl(control) &&
                !isNodeHiddenForSourceScan(control, panel, options) &&
                !isGenericNativeControlTitleElement(control, cleanNativeLabelTitleCandidate(getElementTextSignal(control)))
            ) {
                return control;
            }

            const ariaExpandedTarget = uniqueCandidates.find((candidate) => (
                String(getAttributeValue(candidate, 'aria-expanded')).toLowerCase() === 'false'
            ));
            if (ariaExpandedTarget) return ariaExpandedTarget;

            return uniqueCandidates.find((candidate) => hasCollapsedNativeLabelIconSignal(candidate)) || null;
        }

        function shouldIncludeNativeLabelExpansionTitle(title, options = {}) {
            const requestedTitles = Array.isArray(options.onlyTitles)
                ? options.onlyTitles
                : (Array.isArray(options.expectedLabelTitles) ? options.expectedLabelTitles : []);
            const requestedSet = new Set(requestedTitles
                .map((value) => getComparableNativeLabelTitle(value))
                .filter(Boolean));
            if (requestedSet.size === 0) return true;
            return requestedSet.has(getComparableNativeLabelTitle(title));
        }

        function getCollapsedNativeLabelViewControls(panel = findSourcePanel(), options = {}) {
            const sourcePanel = panel || findSourcePanel();
            if (!sourcePanel) return [];
            const scanOptions = Object.assign({ ignoreManagerSuppression: true }, options || {});
            const controls = queryPanelElements(sourcePanel, LABEL_EXPANSION_CONTROL_SELECTORS);
            const seen = new Set();
            return controls
                .map((control) => getNativeLabelExpansionClickTarget(control, sourcePanel, scanOptions))
                .filter((control) => {
                    if (!control || seen.has(control)) return false;
                    seen.add(control);
                    if (isInsideNativeSourceRowElement(control, sourcePanel)) return false;
                    if (isNativeSourceViewSwitchControl(control)) return false;
                    if (isGenericNativeControlTitleElement(control, cleanNativeLabelTitleCandidate(getElementTextSignal(control)))) return false;
                    const title = getNativeLabelExpansionTitle(control, sourcePanel, scanOptions);
                    if (!shouldIncludeNativeLabelExpansionTitle(title, scanOptions)) return false;
                    const ariaExpanded = String(getAttributeValue(control, 'aria-expanded')).toLowerCase();
                    if (ariaExpanded) return ariaExpanded === 'false';
                    return hasCollapsedNativeLabelIconSignal(control);
                });
        }

        function clickNativeLabelExpansionControl(control) {
            if (!control) return false;
            if (typeof control.click === 'function') {
                control.click();
                return true;
            }
            const win = getWindow();
            const MouseEventCtor = win?.MouseEvent || globalThis.MouseEvent;
            if (typeof control.dispatchEvent === 'function' && typeof MouseEventCtor === 'function') {
                control.dispatchEvent(new MouseEventCtor('click', { bubbles: true, cancelable: true }));
                return true;
            }
            return false;
        }

        function expandCollapsedNativeLabelGroups(panel = findSourcePanel(), options = {}) {
            const sourcePanel = panel || findSourcePanel();
            if (!sourcePanel) {
                return { clickedCount: 0, titles: [] };
            }
            const controls = getCollapsedNativeLabelViewControls(sourcePanel, options);
            const titles = [];
            const clickedControls = [];
            let clickedCount = 0;
            controls.forEach((control) => {
                const title = getNativeLabelExpansionTitle(control, sourcePanel, options);
                if (clickNativeLabelExpansionControl(control)) {
                    clickedCount += 1;
                    clickedControls.push(control);
                    if (title) titles.push(title);
                }
            });
            const result = { clickedCount, titles };
            Object.defineProperty(result, 'clickedControls', {
                value: clickedControls,
                enumerable: false
            });
            return result;
        }

        function restoreNativeLabelExpansionControls(controls = []) {
            const uniqueControls = [];
            const seen = new Set();
            (Array.isArray(controls) ? controls : []).forEach((control) => {
                if (!control || seen.has(control)) return;
                seen.add(control);
                uniqueControls.push(control);
            });

            let clickedCount = 0;
            let failedCount = 0;
            uniqueControls.forEach((control) => {
                try {
                    if (clickNativeLabelExpansionControl(control)) {
                        clickedCount += 1;
                    } else {
                        failedCount += 1;
                    }
                } catch (error) {
                    failedCount += 1;
                }
            });
            return { clickedCount, failedCount };
        }

        function getCollapsedNativeLabelGroupSummaries(panel = findSourcePanel(), options = {}) {
            const sourcePanel = panel || findSourcePanel();
            if (!sourcePanel) return [];
            const summaries = [];
            const seenTitles = new Set();
            getCollapsedNativeLabelViewControls(sourcePanel, options).forEach((control) => {
                const title = getNativeLabelExpansionTitle(control, sourcePanel, options);
                const comparableTitle = getComparableNativeLabelTitle(title);
                if (!title || !comparableTitle || seenTitles.has(comparableTitle)) return;
                seenTitles.add(comparableTitle);
                summaries.push({
                    title,
                    comparableTitle,
                    expectedSourceCount: getNativeLabelExpansionExpectedSourceCount(control, sourcePanel),
                    control
                });
            });
            return summaries;
        }

        function getCollapsedNativeLabelGroupTitles(panel = findSourcePanel(), options = {}) {
            const sourcePanel = panel || findSourcePanel();
            if (!sourcePanel) return [];
            return getCollapsedNativeLabelGroupSummaries(sourcePanel, options)
                .map((summary) => summary.title);
        }

        function isControlInsideSourceEntry(control, sourceEntries = []) {
            return sourceEntries.some((entry) => entry?.row && elementContains(entry.row, control));
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
            const previousInfo = runtime.sourceViewInfo || {};
            runtime.sourceViewKind = nextInfo.kind || SOURCE_VIEW_KIND_UNKNOWN;
            runtime.sourceViewConfidence = Number(nextInfo.confidence) || 0;
            runtime.sourceViewInfo = nextInfo;
            if (previousKind !== runtime.sourceViewKind || !runtime.lastSourceViewChangedAt) {
                runtime.lastSourceViewChangedAt = nextInfo.detectedAt || new Date().toISOString();
                runtime.lastSourceViewTransition = {
                    from: previousKind,
                    to: runtime.sourceViewKind,
                    changedAt: runtime.lastSourceViewChangedAt,
                    previousListRows: Number(previousInfo.listRows) || 0,
                    previousLabelRows: Number(previousInfo.labelRows) || 0,
                    nextListRows: Number(nextInfo.listRows) || 0,
                    nextLabelRows: Number(nextInfo.labelRows) || 0,
                    nextLabelGroups: Number(nextInfo.labelGroups) || 0,
                    nextActiveLabelControls: Number(nextInfo.activeLabelControls) || 0
                };
            }
            return nextInfo;
        }

        function getSourceViewInfo(panel = findSourcePanel()) {
            return updateRuntimeSourceViewInfo(detectSourceView(panel));
        }

        function getListSourceRowSelectors() {
            const depsConfig = getDEPS();
            const configuredRows = Array.isArray(depsConfig.row) ? depsConfig.row : [];
            return Array.from(new Set([
                ...configuredRows,
                ...LABEL_SOURCE_ROW_SELECTORS
            ]));
        }

        function getListSourceEntries(parent = getDocument(), options = {}) {
            const rows = queryPanelElements(parent, getListSourceRowSelectors());
            const shouldFilterHidden = Boolean(options.filterHidden);
            return rows
                .filter((row) => !shouldFilterHidden || !isNodeHiddenForSourceScan(row, parent))
                .filter((row) => !options.excludeLabelRows || !isInsideNativeLabelGroupElement(row, parent))
                .filter((row) => {
                    const identity = extractSourceIdentitySnapshot(row);
                    return isManageableSourceIdentity(identity) || isDetailLikeSourceIdentity(identity);
                })
                .map((row) => ({
                    row,
                    viewKind: SOURCE_VIEW_KIND_LIST,
                    nativeLabelTitle: ''
                }));
        }

        function getLabelSourceEntries(parent = getDocument(), options = {}) {
            const rows = queryPanelElements(parent, LABEL_SOURCE_ROW_SELECTORS);
            const seenRows = new Set();
            const entries = [];

            rows.forEach((row) => {
                if (!row || seenRows.has(row) || isHiddenForNativeLabelRowScan(row, parent, options)) return;
                if (getAttributeValue(row, 'aria-expanded')) return;
                const identity = extractSourceIdentitySnapshot(row);
                if (!isManageableSourceIdentity(identity)) return;

                const nativeLabelTitle = findNativeLabelTitle(row, parent, options);
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

        function getNativeLabelGroupTitle(group, panel, options = {}) {
            if (!group) return '';
            if (typeof group.__nativeLabelTitle === 'string' && group.__nativeLabelTitle.trim()) {
                return group.__nativeLabelTitle.trim();
            }

            const ownLabel = getElementOwnLabel(group);
            if (isLikelyNativeLabelTitle(ownLabel)) {
                return cleanNativeLabelTitleCandidate(ownLabel);
            }

            const title = getNativeLabelTitleFromContainer(group, null, panel, options);
            return title && isLikelyNativeLabelTitle(title) ? title : '';
        }

        function getNativeLabelGroupCheckboxState(group, panel, options = {}) {
            if (!group || isNodeHiddenForSourceScan(group, panel, options)) return null;

            const checkboxCandidates = queryDescendantElements(group, [
                'input[type="checkbox"]',
                '[role="checkbox"]',
                'mat-checkbox',
                '.mat-checkbox',
                '.mat-mdc-checkbox',
                '.mdc-checkbox'
            ]);
            if (typeof group.querySelector === 'function') {
                const fallback = group.querySelector('input[type="checkbox"], [role="checkbox"], mat-checkbox, .mat-checkbox, .mat-mdc-checkbox, .mdc-checkbox');
                if (fallback && !checkboxCandidates.includes(fallback)) {
                    checkboxCandidates.push(fallback);
                }
            }

            for (const checkbox of checkboxCandidates) {
                if (!checkbox) continue;
                if (isInsideNativeSourceRowElement(checkbox, group)) continue;
                if (isNativeSourceViewSwitchControl(checkbox)) continue;
                if (isNodeHiddenForSourceScan(checkbox, group, options)) continue;
                const state = getNativeCheckboxState(checkbox);
                if (state !== null) return state;
            }

            return null;
        }

        function getNativeLabelGroupSelectionMap(panel = findSourcePanel(), options = {}) {
            const sourcePanel = panel || findSourcePanel();
            const selections = new Map();
            if (!sourcePanel) return selections;

            const scanOptions = Object.assign({ ignoreManagerSuppression: true, inferNativeLabelTitles: true }, options || {});
            const groups = queryPanelElements(sourcePanel, LABEL_GROUP_SELECTORS)
                .filter((group) => (
                    group &&
                    !isNativeSourceViewSwitchControl(group) &&
                    !isNativeLabelEntryPointControl(group) &&
                    !isNodeHiddenForSourceScan(group, sourcePanel, scanOptions)
                ));

            groups.forEach((group) => {
                const title = getNativeLabelGroupTitle(group, sourcePanel, scanOptions);
                if (!title) return;
                const state = getNativeLabelGroupCheckboxState(group, sourcePanel, scanOptions);
                if (state === null) return;
                selections.set(getComparableNativeLabelTitle(title), {
                    title,
                    enabled: state
                });
            });

            return selections;
        }

        function collectSourceKeysFromGroup(group, groupsById, result = new Set()) {
            if (!group || !Array.isArray(group.children)) return result;
            group.children.forEach((child) => {
                if (!child) return;
                if (child.type === 'source' && child.key) {
                    result.add(child.key);
                    return;
                }
                if (child.type === 'group' && child.id && groupsById.has(child.id)) {
                    collectSourceKeysFromGroup(groupsById.get(child.id), groupsById, result);
                }
            });
            return result;
        }

        function collectGroupedSourceRefs(groupsById) {
            const refs = new Set();
            if (!groupsById || typeof groupsById.forEach !== 'function') return refs;
            groupsById.forEach((group) => {
                collectSourceKeysFromGroup(group, groupsById, refs);
            });
            return refs;
        }

        function shouldPreserveExistingTreeDuringUnsafeRemap(remappedState, previousSourceRecordsByKey, sourceLookup) {
            const currentGroupsById = getGroupsById();
            const previousGroupedRefs = collectGroupedSourceRefs(currentGroupsById);
            if (previousGroupedRefs.size === 0) return false;

            const remappedGroupsById = remappedState?.groupsById instanceof Map
                ? remappedState.groupsById
                : new Map();
            const nextGroupedRefs = collectGroupedSourceRefs(remappedGroupsById);
            const lostGroupedRefs = [];
            const lostGroupedRefsWithoutRecords = [];

            previousGroupedRefs.forEach((storedKey) => {
                const sourceRecord = previousSourceRecordsByKey?.get?.(storedKey) || null;
                const resolution = resolveStoredSourceKeyWithReason(storedKey, sourceLookup, sourceRecord);
                const resolvedKey = resolution?.key || storedKey;
                if (!nextGroupedRefs.has(resolvedKey)) {
                    lostGroupedRefs.push(storedKey);
                    if (!sourceRecord) {
                        lostGroupedRefsWithoutRecords.push(storedKey);
                    }
                }
            });

            if (lostGroupedRefs.length === 0) return false;
            if (lostGroupedRefsWithoutRecords.length === 0) return false;

            const recentNativeDeletedSourceKeys = runtime.recentNativeDeletedSourceKeys instanceof Set
                ? runtime.recentNativeDeletedSourceKeys
                : null;
            if (
                recentNativeDeletedSourceKeys &&
                lostGroupedRefs.every((key) => recentNativeDeletedSourceKeys.has(key))
            ) {
                lostGroupedRefs.forEach((key) => recentNativeDeletedSourceKeys.delete(key));
                return false;
            }

            runtime.lastSkippedStructuralSourceSync = {
                previousGroupedSourceCount: previousGroupedRefs.size,
                nextGroupedSourceCount: nextGroupedRefs.size,
                lostGroupedSourceCount: lostGroupedRefs.length,
                lostGroupedSourceWithoutRecordCount: lostGroupedRefsWithoutRecords.length,
                lostGroupedSourceKeys: lostGroupedRefs.slice(0, 10),
                skippedAt: new Date().toISOString(),
                reason: 'would_drop_grouped_sources'
            };
            return true;
        }

        function applyNativeLabelGroupSelectionsToExistingSources(selectionMap) {
            const sourcesByKey = getSourcesByKey();
            const groupsById = getGroupsById();
            if (!(selectionMap instanceof Map) || selectionMap.size === 0 || sourcesByKey.size === 0) return false;

            const selectedKeys = new Set();

            sourcesByKey.forEach((source, sourceKey) => {
                const selection = selectionMap.get(getComparableNativeLabelTitle(source?.nativeLabelTitle));
                if (!selection) return;
                selectedKeys.add(sourceKey);
                if (source.enabled !== selection.enabled) {
                    source.enabled = selection.enabled;
                }
            });

            groupsById.forEach((group) => {
                const selection = selectionMap.get(getComparableNativeLabelTitle(group?.nativeLabelTitle));
                if (!selection) return;
                collectSourceKeysFromGroup(group, groupsById, new Set()).forEach((sourceKey) => {
                    selectedKeys.add(sourceKey);
                    const source = sourcesByKey.get(sourceKey);
                    if (source && source.enabled !== selection.enabled) {
                        source.enabled = selection.enabled;
                    }
                });
            });

            return selectedKeys.size > 0;
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

            const baseLabelScanOptions = {};
            const labelGroups = queryPanelElements(sourcePanel, LABEL_GROUP_SELECTORS)
                .filter((group) => (
                    !isNativeSourceViewSwitchControl(group) &&
                    !isNativeLabelEntryPointControl(group) &&
                    !isNodeHiddenForSourceScan(group, sourcePanel, baseLabelScanOptions)
                ));
            const listEntries = getListSourceEntries(sourcePanel, { excludeLabelRows: true });
            const activeLabelControls = getActiveNativeLabelViewControls(sourcePanel, baseLabelScanOptions)
                .filter((control) => !isNativeSourceViewSwitchControl(control))
                .filter((control) => !isControlInsideSourceEntry(control, listEntries));
            const labelScanOptions = Object.assign({}, baseLabelScanOptions, {
                inferNativeLabelTitles: labelGroups.length > 0 || activeLabelControls.length > 0
            });
            const labelEntries = getLabelSourceEntries(sourcePanel, labelScanOptions);
            const labelTextSignals = labelGroups.filter((group) => LABEL_VIEW_TEXT_PATTERN.test(getElementTextSignal(group)));

            if (labelEntries.length > 0) {
                return createSourceViewInfo(SOURCE_VIEW_KIND_LABEL, labelTextSignals.length > 0 ? 0.92 : 0.82, {
                    listRows: listEntries.length,
                    labelRows: labelEntries.length,
                    labelGroups: labelGroups.length,
                    activeLabelControls: activeLabelControls.length
                });
            }

            if (activeLabelControls.length > 0) {
                return createSourceViewInfo(SOURCE_VIEW_KIND_LABEL, 0.78, {
                    listRows: listEntries.length,
                    labelRows: 0,
                    labelGroups: labelGroups.length,
                    activeLabelControls: activeLabelControls.length
                });
            }

            if (listEntries.length > 0) {
                return createSourceViewInfo(SOURCE_VIEW_KIND_LIST, 0.9, {
                    listRows: listEntries.length,
                    labelRows: 0,
                    labelGroups: labelGroups.length,
                    activeLabelControls: 0
                });
            }

            if (labelGroups.length > 0 || labelTextSignals.length > 0) {
                return createSourceViewInfo(SOURCE_VIEW_KIND_LABEL, 0.45, {
                    listRows: 0,
                    labelRows: 0,
                    labelGroups: labelGroups.length,
                    activeLabelControls: activeLabelControls.length
                });
            }

            return createSourceViewInfo(SOURCE_VIEW_KIND_UNKNOWN, 0, {
                listRows: 0,
                labelRows: 0,
                labelGroups: 0,
                activeLabelControls: 0
            });
        }

        function getSourceEntries(parent = getDocument(), options = {}) {
            const info = getSourceViewInfo(parent);
            if (info.kind === SOURCE_VIEW_KIND_LABEL) {
                const labelEntries = getLabelSourceEntries(parent, {
                    ignoreManagerSuppression: true,
                    inferNativeLabelTitles: true,
                    includeHiddenNativeLabelRows: Boolean(options.includeHiddenNativeLabelRows)
                });
                if (labelEntries.length > 0) return labelEntries;
                return getListSourceEntries(parent, { filterHidden: true });
            }
            if (info.kind === SOURCE_VIEW_KIND_LIST) {
                return getListSourceEntries(parent, { excludeLabelRows: true });
            }
            return getListSourceEntries(parent, { filterHidden: true, excludeLabelRows: true });
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
            return partialSyncShouldPreserveExistingSources(currentSources, sourceLookup, previousSourceRecordsByKey, {
                recentNativeDeletedSourceKeys: runtime.recentNativeDeletedSourceKeys
            });
        }

        function hasPreviousRecordForCurrentSource(source, sourceLookup, previousSourceRecordsByKey) {
            return partialSyncHasPreviousRecord(source, sourceLookup, previousSourceRecordsByKey);
        }

        function markTransientRawUrlImportSources(currentSources, sourceLookup, previousSourceRecordsByKey) {
            return partialSyncMarkTransientRawUrlImportSources(currentSources, sourceLookup, previousSourceRecordsByKey);
        }

        function mergeVisibleLoadingSourcesDuringPartialSync(currentSources, sourceLookup, previousSourceRecordsByKey, keyByElement) {
            const loadingSources = (Array.isArray(currentSources) ? currentSources : [])
                .filter((source) => (
                    source?.isLoading &&
                    source.key &&
                    !hasPreviousRecordForCurrentSource(source, sourceLookup, previousSourceRecordsByKey)
                ));
            if (loadingSources.length === 0) return 0;

            const sourcesByKey = getSourcesByKey();
            const state = getState();
            const groupsById = getGroupsById();
            const knownSourceRefs = collectGroupedSourceRefs(groupsById);
            if (!Array.isArray(state.ungrouped)) {
                state.ungrouped = [];
            }
            state.ungrouped.forEach((sourceKey) => {
                if (sourceKey) knownSourceRefs.add(sourceKey);
            });

            let mergedCount = 0;
            loadingSources.forEach((source) => {
                const hydratedSource = {
                    ...source,
                    enabled: getNativeSourceCheckboxState(source, true),
                    nativeLabelTitle: source.nativeLabelTitle || ''
                };

                sourcesByKey.set(source.key, hydratedSource);
                setSourceTagIds(source.key, []);
                if (source.element && keyByElement && typeof keyByElement.set === 'function') {
                    keyByElement.set(source.element, source.key);
                }
                if (!knownSourceRefs.has(source.key)) {
                    state.ungrouped.push(source.key);
                    knownSourceRefs.add(source.key);
                }
                syncSourceToPage(hydratedSource, isSourceEffectivelyEnabled(hydratedSource), {
                    currentSourceViewKind: runtime.sourceViewKind || SOURCE_VIEW_KIND_UNKNOWN,
                    preferStoredCheckbox: true
                });
                mergedCount += 1;
            });

            if (mergedCount > 0) {
                runtime.keyByElement = keyByElement;
                buildParentMap();
            }
            return mergedCount;
        }

        function getRecentNativeDeletedSourceKeys() {
            return runtime.recentNativeDeletedSourceKeys instanceof Set
                ? runtime.recentNativeDeletedSourceKeys
                : null;
        }

        function getRecentNativeDeletedSourceIdentityKeys() {
            return runtime.recentNativeDeletedSourceIdentityKeys instanceof Set
                ? runtime.recentNativeDeletedSourceIdentityKeys
                : null;
        }

        function isRecentlyNativeDeletedSource(source) {
            if (!source) return false;

            const recentSourceKeys = getRecentNativeDeletedSourceKeys();
            if (recentSourceKeys && source.key && recentSourceKeys.has(source.key)) {
                return true;
            }

            const recentIdentityKeys = getRecentNativeDeletedSourceIdentityKeys();
            if (!recentIdentityKeys) return false;
            if (source.stableToken && recentIdentityKeys.has(`stable:${source.stableToken}`)) {
                return true;
            }
            if (source.fingerprint && recentIdentityKeys.has(`fingerprint:${source.fingerprint}`)) {
                return true;
            }

            return false;
        }

        function collectRemovedNativeLabelSourceRows(node, rows, seenRows) {
            if (!node || node.nodeType !== 1) return;
            if (isLikelySourceRowElement(node) && !seenRows.has(node)) {
                seenRows.add(node);
                rows.push(node);
            }
            if (typeof node.querySelectorAll !== 'function') return;
            LABEL_SOURCE_ROW_SELECTORS.forEach((selector) => {
                try {
                    node.querySelectorAll(selector).forEach((row) => {
                        if (row && !seenRows.has(row)) {
                            seenRows.add(row);
                            rows.push(row);
                        }
                    });
                } catch (error) {
                    // Ignore selector failures from framework-owned detached nodes.
                }
            });
        }

        function captureRemovedNativeLabelSourceRows(mutations = []) {
            if (runtime.sourceViewKind !== SOURCE_VIEW_KIND_LABEL && runtime.sourceViewInfo?.kind !== SOURCE_VIEW_KIND_LABEL) {
                return false;
            }
            const sourcePanel = findSourcePanel();
            if (!sourcePanel || !Array.isArray(mutations) || mutations.length === 0) return false;

            const rows = [];
            const seenRows = new Set();
            mutations.forEach((mutation) => {
                Array.from(mutation?.removedNodes || []).forEach((node) => {
                    collectRemovedNativeLabelSourceRows(node, rows, seenRows);
                });
            });
            if (rows.length === 0) return false;

            const sourcesByKey = getSourcesByKey();
            const state = getState();
            const knownSourceRefs = new Set(Array.isArray(state.ungrouped) ? state.ungrouped : []);
            getGroupsById().forEach((group) => {
                collectSourceKeysFromGroup(group, getGroupsById(), knownSourceRefs);
            });

            let captured = false;
            const seenSourceIds = new Map();
            const seenLegacyKeys = new Map();
            rows.forEach((row) => {
                const nativeLabelTitle = findNativeLabelTitle(row, sourcePanel, {
                    ignoreManagerSuppression: true,
                    inferNativeLabelTitles: true
                });
                if (!nativeLabelTitle) return;
                const descriptor = createSourceDescriptor(row, seenSourceIds, seenLegacyKeys);
                if (!descriptor || isRecentlyNativeDeletedSource(descriptor)) return;

                const previous = sourcesByKey.get(descriptor.key) || null;
                const previousEnabled = previous ? Boolean(previous.enabled) : true;
                const nativeCheckboxState = getNativeSourceCheckboxState(descriptor, previousEnabled);
                sourcesByKey.set(descriptor.key, Object.assign({}, descriptor, {
                    enabled: previous ? previousEnabled : nativeCheckboxState,
                    nativeLabelTitle: previous?.nativeLabelTitle || nativeLabelTitle,
                    sourceViewKind: SOURCE_VIEW_KIND_LABEL
                }));
                if (!knownSourceRefs.has(descriptor.key)) {
                    state.ungrouped.push(descriptor.key);
                    knownSourceRefs.add(descriptor.key);
                }
                captured = true;
            });

            if (captured) {
                buildParentMap();
            }
            return captured;
        }

        function scanAndSyncSources(loadedState, isFirstLoad = false, options = {}) {
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
                    oldSourcesMap.set(key, {
                        enabled: source.enabled,
                        nativeLabelTitle: source.nativeLabelTitle || '',
                        addedAt: source.addedAt || ''
                    });
                });
                sourceTagsById.forEach((tagIds, key) => {
                    oldSourceTags.set(key, [...tagIds]);
                });
            }

            const sourcePanel = findSourcePanel();
            const sourceRoot = sourcePanel || getDocument();
            const sourceEntries = getSourceEntries(sourceRoot, options);
            developerLog('debug', 'source_sync', 'scan_started', {
                isFirstLoad,
                sourceViewKind: runtime.sourceViewKind || SOURCE_VIEW_KIND_UNKNOWN,
                rowCount: sourceEntries.length,
                includeHiddenNativeLabelRows: Boolean(options.includeHiddenNativeLabelRows)
            });
            const nativeLabelGroupSelections = (runtime.sourceViewKind === SOURCE_VIEW_KIND_LABEL)
                ? getNativeLabelGroupSelectionMap(sourceRoot)
                : new Map();
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
                .filter((source) => source && !isRecentlyNativeDeletedSource(source));
            const sourceLookup = buildSourceLookup(currentSources);
            const transientRawUrlSourceCount = !isFirstLoad
                ? markTransientRawUrlImportSources(currentSources, sourceLookup, previousSourceRecordsByKey)
                : 0;
            if (transientRawUrlSourceCount > 0) {
                developerLog('debug', 'source_sync', 'raw_url_import_rows_marked_loading', {
                    count: transientRawUrlSourceCount
                });
            }
            if (!isFirstLoad && nativeLabelGroupSelections.size > 0 && applyNativeLabelGroupSelectionsToExistingSources(nativeLabelGroupSelections)) {
                oldSourcesMap.clear();
                sourcesByKey.forEach((source, key) => {
                    oldSourcesMap.set(key, {
                        enabled: source.enabled,
                        nativeLabelTitle: source.nativeLabelTitle || '',
                        addedAt: source.addedAt || ''
                    });
                });
            }
            if (!isFirstLoad && shouldPreserveExistingSourcesDuringPartialSync(currentSources, sourceLookup, previousSourceRecordsByKey)) {
                const transientLoadingSourceCount = mergeVisibleLoadingSourcesDuringPartialSync(
                    currentSources,
                    sourceLookup,
                    previousSourceRecordsByKey,
                    keyByElement
                );
                runtime.lastSkippedPartialSourceSync = {
                    previousCount: previousSourceRecordsByKey.size,
                    currentCount: currentSources.length,
                    transientLoadingSourceCount,
                    skippedAt: new Date().toISOString()
                };
                developerLog('warn', 'source_sync', 'scan_skipped_partial_sync', {
                    previousCount: previousSourceRecordsByKey.size,
                    currentCount: currentSources.length,
                    transientLoadingSourceCount,
                    reason: 'partial_source_sync'
                });
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
                if (shouldPreserveExistingTreeDuringUnsafeRemap(remappedState, previousSourceRecordsByKey, sourceLookup)) {
                    developerLog('warn', 'source_sync', 'scan_skipped_unsafe_remap', {
                        previousCount: previousSourceRecordsByKey.size,
                        currentCount: currentSources.length,
                        reason: 'unsafe_remap'
                    });
                    return false;
                }
                state.groups = remappedState.groups;
                state.ungrouped = remappedState.ungrouped;
                groupsById.clear();
                remappedState.groupsById.forEach((group, groupId) => {
                    groupsById.set(groupId, group);
                });
                oldSourcesMap.clear();
                remappedState.sourceStateById.forEach((sourceRecord, sourceKey) => {
                    const existingSource = sourcesByKey.get(sourceKey);
                    oldSourcesMap.set(sourceKey, {
                        enabled: Boolean(sourceRecord.enabled),
                        nativeLabelTitle: sourceRecord.nativeLabelTitle || existingSource?.nativeLabelTitle || '',
                        addedAt: sourceRecord.addedAt || existingSource?.addedAt || ''
                    });
                });
                oldSourceTags.clear();
                remappedState.sourceTagsById.forEach((tagIds, sourceKey) => {
                    oldSourceTags.set(sourceKey, [...tagIds]);
                });
                knownSourceRefs = remappedState.seenSourceRefs;
            }

            currentSources.forEach((source) => {
                let enabled;
                const previousSourceState = oldSourcesMap.get(source.key) || null;
                const resolvedSourceState = isFirstLoad ? (resolvedSourceStateById.get(source.key) || null) : null;
                const previousEnabled = previousSourceState ? Boolean(previousSourceState.enabled) : true;
                const nativeCheckboxState = getNativeSourceCheckboxState(source, previousEnabled);
                const nativeLabelTitle = source.nativeLabelTitle || previousSourceState?.nativeLabelTitle || '';
                const nativeLabelGroupSelection = nativeLabelGroupSelections.get(getComparableNativeLabelTitle(nativeLabelTitle));
                const addedAt = isFirstLoad
                    ? (resolvedSourceStateById.has(source.key) ? (resolvedSourceState?.addedAt || '') : new Date().toISOString())
                    : (oldSourcesMap.has(source.key) ? (previousSourceState?.addedAt || '') : new Date().toISOString());
                if (isFirstLoad) {
                    enabled = resolvedSourceStateById.has(source.key)
                        ? Boolean(resolvedSourceState.enabled)
                        : nativeCheckboxState;
                } else if (source.sourceViewKind === SOURCE_VIEW_KIND_LABEL && nativeLabelGroupSelection) {
                    enabled = Boolean(nativeLabelGroupSelection.enabled);
                } else if (source.sourceViewKind === SOURCE_VIEW_KIND_LABEL && source.hasNativeCheckbox) {
                    enabled = nativeCheckboxState;
                } else {
                    enabled = oldSourcesMap.has(source.key)
                        ? Boolean(oldSourcesMap.get(source.key).enabled)
                        : nativeCheckboxState;
                }

                const hydratedSource = {
                    ...source,
                    enabled,
                    nativeLabelTitle,
                    addedAt
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
                syncSourceToPage(source, isSourceEffectivelyEnabled(source), {
                    currentSourceViewKind: runtime.sourceViewKind || SOURCE_VIEW_KIND_UNKNOWN,
                    preferStoredCheckbox: true
                });
            });

            const pendingStorageUpgrade = isFirstLoad && getPendingStorageUpgrade();
            developerLog('debug', 'source_sync', 'scan_finished', {
                isFirstLoad,
                sourceCount: sourcesByKey.size,
                groupCount: groupsById.size,
                pendingStorageUpgrade
            });
            return pendingStorageUpgrade;
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

        function hasManageableSourceDescendant(element) {
            if (!element || element.nodeType !== 1 || typeof element.querySelector !== 'function') return false;
            return getListSourceRowSelectors().some((selector) => {
                try {
                    const candidate = element.querySelector(selector);
                    return Boolean(
                        candidate &&
                        isManageableSourceIdentity(extractSourceIdentitySnapshot(candidate))
                    );
                } catch (error) {
                    return false;
                }
            });
        }

        function isCheckboxLikeMutationTarget(element) {
            if (!element || element.nodeType !== 1) return false;
            const tagName = String(element.tagName || '').toLowerCase();
            const type = String(element.type || getAttributeValue(element, 'type')).toLowerCase();
            const role = getAttributeValue(element, 'role').toLowerCase();
            if ((tagName === 'input' && type === 'checkbox') || role === 'checkbox') return true;
            if (tagName === 'mat-checkbox') return true;
            try {
                return Boolean(element.matches?.('input[type="checkbox"], [role="checkbox"], mat-checkbox, .mat-checkbox, .mat-mdc-checkbox, .mdc-checkbox'));
            } catch (error) {
                return false;
            }
        }

        function isCurrentNativeLabelView() {
            return (
                runtime.sourceViewKind === SOURCE_VIEW_KIND_LABEL ||
                runtime.sourceViewInfo?.kind === SOURCE_VIEW_KIND_LABEL
            );
        }

        function isNativeLabelMutationTarget(element) {
            if (!element || element.nodeType !== 1) return false;
            if (isInsideNativeSourceRowElement(element)) return false;
            if (isNativeSourceViewSwitchControl(element)) return true;
            if (isNativeLabelHeaderElement(element)) return true;

            let cursor = element;
            let depth = 0;
            while (cursor && depth < 8) {
                if (elementMatchesAny(cursor, LABEL_GROUP_SELECTORS)) return true;
                cursor = getParentElement(cursor);
                depth += 1;
            }

            return false;
        }

        function isNonCriticalAttributeMutationRelevant(attributeName, targetElement) {
            if (!targetElement) return false;

            if (['aria-checked', 'checked'].includes(attributeName)) {
                return isCheckboxLikeMutationTarget(targetElement);
            }

            if (attributeName === 'aria-expanded') {
                return isElementWithinSourceRow(targetElement) || isNativeLabelMutationTarget(targetElement);
            }

            if (['class', 'style', 'hidden'].includes(attributeName)) {
                if (isElementWithinSourceRow(targetElement)) return true;
                return isCurrentNativeLabelView() && isNativeLabelMutationTarget(targetElement);
            }

            if (attributeName === 'data-testid') {
                if (isElementWithinSourceRow(targetElement)) return true;
                return isCurrentNativeLabelView() && isNativeLabelMutationTarget(targetElement);
            }

            if (SOURCE_STATUS_ATTRIBUTE_NAMES.has(attributeName)) {
                return isElementWithinSourceRow(targetElement) || hasManageableSourceDescendant(targetElement);
            }

            return false;
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
                isElementWithinSourceRow(node) ||
                hasManageableSourceDescendant(node)
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
                if (isNonCriticalAttributeMutationRelevant(attributeName, targetElement)) {
                    return {
                        relevant: true,
                        critical: false
                    };
                }
                if (!SOURCE_RENAME_ATTRIBUTE_NAMES.has(attributeName)) {
                    return { relevant: false, critical: false };
                }
                return {
                    relevant: isElementWithinSourceRow(targetElement),
                    critical: isElementWithinSourceRow(targetElement)
                };
            }

            return { relevant: false, critical: false };
        }

        function handleDomChanges(mutations) {
            try {
                captureRemovedNativeLabelSourceRows(Array.from(mutations || []));
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
            getCollapsedNativeLabelViewControls,
            getCollapsedNativeLabelGroupSummaries,
            getCollapsedNativeLabelGroupTitles,
            expandCollapsedNativeLabelGroups,
            restoreNativeLabelExpansionControls,
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
