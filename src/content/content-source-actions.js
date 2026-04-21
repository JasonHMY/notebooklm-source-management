(function () {
    'use strict';

    function createContentSourceActions(deps = {}) {
        const getDocument = typeof deps.getDocument === 'function'
            ? deps.getDocument
            : () => (typeof document !== 'undefined' ? document : null);
        const getWindow = typeof deps.getWindow === 'function'
            ? deps.getWindow
            : () => (typeof window !== 'undefined' ? window : null);
        const getState = typeof deps.getState === 'function'
            ? deps.getState
            : () => (deps.state || {});
        const getSourcesByKey = typeof deps.getSourcesByKey === 'function'
            ? deps.getSourcesByKey
            : () => (deps.sourcesByKey || new Map());
        const getShadowRoot = typeof deps.getShadowRoot === 'function'
            ? deps.getShadowRoot
            : () => (deps.shadowRoot || null);
        const getDEPS = typeof deps.getDEPS === 'function'
            ? deps.getDEPS
            : () => (deps.DEPS || {});
        const getMessage = typeof deps.getMessage === 'function'
            ? deps.getMessage
            : (key) => key;
        const showToast = typeof deps.showToast === 'function'
            ? deps.showToast
            : () => {};
        const render = typeof deps.render === 'function'
            ? deps.render
            : () => {};
        const sourceMatchesCurrentFilters = typeof deps.sourceMatchesCurrentFilters === 'function'
            ? deps.sourceMatchesCurrentFilters
            : () => true;
        const resolveFreshRowEntry = typeof deps.resolveFreshRowEntry === 'function'
            ? deps.resolveFreshRowEntry
            : () => null;
        const renderTagModal = typeof deps.renderTagModal === 'function'
            ? deps.renderTagModal
            : () => false;
        const renderMoveToFolderModal = typeof deps.renderMoveToFolderModal === 'function'
            ? deps.renderMoveToFolderModal
            : () => false;
        const markSourceDetailViewRequested = typeof deps.markSourceDetailViewRequested === 'function'
            ? deps.markSourceDetailViewRequested
            : () => {};
        const findElement = typeof deps.findElement === 'function'
            ? deps.findElement
            : (selectors, parent) => {
                const root = parent || getDocument();
                if (!root || typeof root.querySelector !== 'function') return null;
                const list = Array.isArray(selectors) ? selectors : [];
                for (const selector of list) {
                    const element = root.querySelector(selector);
                    if (element) return element;
                }
                return null;
            };

        let activeSourceActionSourceKey = null;
        let activeSourceActionSubmenuAction = null;
        let sourceActionMenuPosition = null;
        let sourceActionInvokers = Object.create(null);

        const SOURCE_ACTION_MENU_WIDTH = 220;
        const SOURCE_ACTION_MENU_ITEM_HEIGHT = 42;
        const SOURCE_ACTION_MENU_INSET_PADDING = 8;
        const SOURCE_ACTION_MENU_ITEM_GAP = 2;
        const SOURCE_ACTION_MENU_GAP = 8;
        const SOURCE_ACTION_MENU_VIEWPORT_PADDING = 8;

        const NATIVE_MENU_ITEM_SELECTORS = [
            '.cdk-overlay-container [role="menuitem"]',
            '.cdk-overlay-container [role="menuitemcheckbox"]',
            '.cdk-overlay-container .mat-mdc-menu-item',
            '.cdk-overlay-container .mat-menu-item',
            '.cdk-overlay-container [mat-menu-item]'
        ];

        function canOpenSourceActionMenu(source) {
            const state = getState() || {};
            return Boolean(source && !state.isBatchMode && !source.isLoading && !source.isDisabled);
        }

        function getViewportSize() {
            const win = getWindow();
            const doc = getDocument();
            const docEl = doc?.documentElement;
            return {
                width: Number(win?.innerWidth) || Number(docEl?.clientWidth) || 1280,
                height: Number(win?.innerHeight) || Number(docEl?.clientHeight) || 720
            };
        }

        function findSourceActionButton(sourceKey) {
            const shadowRoot = getShadowRoot();
            if (!shadowRoot || !sourceKey) return null;
            const buttons = shadowRoot.querySelectorAll('.sp-source-actions-button');
            return Array.from(buttons).find((button) => button?.dataset?.sourceKey === sourceKey) || null;
        }

        function getSourceActionMenuItems(sourceKey) {
            const source = sourceKey ? getSourcesByKey().get(sourceKey) : null;
            if (!source || !canOpenSourceActionMenu(source)) return [];

            return [
                {
                    action: 'view-source',
                    kind: 'submenu',
                    icon: 'visibility',
                    label: getMessage('ui_view_source'),
                    children: [
                        {
                            action: 'view-source-details',
                            kind: 'action',
                            icon: 'description',
                            label: getMessage('ui_view_source_details')
                        }
                    ]
                },
                {
                    action: 'tags',
                    kind: 'action',
                    icon: 'sell',
                    label: getMessage('ui_edit_tags')
                },
                {
                    action: 'move',
                    kind: 'action',
                    icon: 'drive_file_move',
                    label: getMessage('ui_move_to_folder')
                },
                {
                    action: 'native-more',
                    kind: 'action',
                    icon: 'open_in_new',
                    label: getMessage('ui_open_native_menu')
                }
            ];
        }

        function getSourceActionSubmenuItems(sourceKey, submenuAction) {
            const parentItem = getSourceActionMenuItems(sourceKey).find((item) => (
                item.kind === 'submenu' && item.action === submenuAction
            ));
            return Array.isArray(parentItem?.children) ? parentItem.children : [];
        }

        function getSourceActionMenuHeight(menuItemCount = 0) {
            if (menuItemCount <= 0) return 146;
            return (SOURCE_ACTION_MENU_INSET_PADDING * 2) +
                (menuItemCount * SOURCE_ACTION_MENU_ITEM_HEIGHT) +
                (Math.max(0, menuItemCount - 1) * SOURCE_ACTION_MENU_ITEM_GAP);
        }

        function getSourceActionMenuPosition(triggerElement, menuItemCount = 0) {
            const triggerRect = triggerElement && typeof triggerElement.getBoundingClientRect === 'function'
                ? (() => {
                    try {
                        return triggerElement.getBoundingClientRect();
                    } catch (error) {
                        return null;
                    }
                })()
                : null;
            if (!triggerRect) return null;

            const menuHeight = getSourceActionMenuHeight(menuItemCount);
            const viewport = getViewportSize();

            let left = triggerRect.left - 4;
            left = Math.min(
                Math.max(left, SOURCE_ACTION_MENU_VIEWPORT_PADDING),
                Math.max(
                    SOURCE_ACTION_MENU_VIEWPORT_PADDING,
                    viewport.width - SOURCE_ACTION_MENU_WIDTH - SOURCE_ACTION_MENU_VIEWPORT_PADDING
                )
            );

            let top = triggerRect.bottom + SOURCE_ACTION_MENU_GAP;
            let placement = 'bottom';
            if (top + menuHeight > viewport.height - SOURCE_ACTION_MENU_VIEWPORT_PADDING) {
                const topPlacement = triggerRect.top - menuHeight - SOURCE_ACTION_MENU_GAP;
                if (topPlacement >= SOURCE_ACTION_MENU_VIEWPORT_PADDING) {
                    top = topPlacement;
                    placement = 'top';
                } else {
                    top = Math.max(
                        SOURCE_ACTION_MENU_VIEWPORT_PADDING,
                        viewport.height - menuHeight - SOURCE_ACTION_MENU_VIEWPORT_PADDING
                    );
                }
            }

            return { top, left, placement };
        }

        function getSourceActionSubmenuPosition(parentMenuPosition, parentItemIndex, submenuItemCount = 0) {
            if (!parentMenuPosition || parentItemIndex < 0 || submenuItemCount <= 0) return null;

            const menuHeight = getSourceActionMenuHeight(submenuItemCount);
            const viewport = getViewportSize();
            const itemTop = parentMenuPosition.top +
                SOURCE_ACTION_MENU_INSET_PADDING +
                (parentItemIndex * (SOURCE_ACTION_MENU_ITEM_HEIGHT + SOURCE_ACTION_MENU_ITEM_GAP));

            let left = parentMenuPosition.left + SOURCE_ACTION_MENU_WIDTH + SOURCE_ACTION_MENU_GAP;
            let horizontalPlacement = 'right';
            if (left + SOURCE_ACTION_MENU_WIDTH > viewport.width - SOURCE_ACTION_MENU_VIEWPORT_PADDING) {
                left = parentMenuPosition.left - SOURCE_ACTION_MENU_WIDTH - SOURCE_ACTION_MENU_GAP;
                horizontalPlacement = 'left';
            }
            left = Math.max(
                SOURCE_ACTION_MENU_VIEWPORT_PADDING,
                Math.min(left, viewport.width - SOURCE_ACTION_MENU_WIDTH - SOURCE_ACTION_MENU_VIEWPORT_PADDING)
            );

            const top = Math.max(
                SOURCE_ACTION_MENU_VIEWPORT_PADDING,
                Math.min(
                    itemTop - SOURCE_ACTION_MENU_INSET_PADDING,
                    viewport.height - menuHeight - SOURCE_ACTION_MENU_VIEWPORT_PADDING
                )
            );

            return { top, left, horizontalPlacement };
        }

        function closeSourceActionMenu() {
            activeSourceActionSourceKey = null;
            activeSourceActionSubmenuAction = null;
            sourceActionMenuPosition = null;
        }

        function dismissSourceActionMenuAndRender() {
            if (!activeSourceActionSourceKey) return false;
            closeSourceActionMenu();
            render();
            return true;
        }

        function toggleSourceActionMenu(sourceKey, triggerElement = null) {
            if (!sourceKey) {
                closeSourceActionMenu();
                return activeSourceActionSourceKey;
            }

            const source = getSourcesByKey().get(sourceKey);
            if (!canOpenSourceActionMenu(source)) {
                closeSourceActionMenu();
                return activeSourceActionSourceKey;
            }

            if (activeSourceActionSourceKey === sourceKey) {
                closeSourceActionMenu();
                return activeSourceActionSourceKey;
            }

            activeSourceActionSourceKey = sourceKey;
            activeSourceActionSubmenuAction = null;
            const menuItems = getSourceActionMenuItems(sourceKey);
            sourceActionMenuPosition = getSourceActionMenuPosition(
                triggerElement || findSourceActionButton(sourceKey),
                menuItems.length
            );
            return activeSourceActionSourceKey;
        }

        function syncActiveSourceActionMenuState() {
            if (!activeSourceActionSourceKey) return false;

            const activeSource = getSourcesByKey().get(activeSourceActionSourceKey);
            if (
                !canOpenSourceActionMenu(activeSource) ||
                !sourceMatchesCurrentFilters(activeSource)
            ) {
                closeSourceActionMenu();
                return true;
            }

            const actionButton = findSourceActionButton(activeSourceActionSourceKey);
            if (!actionButton) {
                closeSourceActionMenu();
                return true;
            }

            const menuItems = getSourceActionMenuItems(activeSourceActionSourceKey);
            if (
                activeSourceActionSubmenuAction &&
                getSourceActionSubmenuItems(activeSourceActionSourceKey, activeSourceActionSubmenuAction).length === 0
            ) {
                activeSourceActionSubmenuAction = null;
            }
            sourceActionMenuPosition = getSourceActionMenuPosition(actionButton, menuItems.length);
            return false;
        }

        function findNativeSourceMenuButton(sourceKey) {
            const source = getSourcesByKey().get(sourceKey);
            if (!source) return null;

            const depsConfig = getDEPS();
            let nativeMoreBtn = source.element ? findElement(depsConfig.moreBtn, source.element) : null;
            const doc = getDocument();
            if (!nativeMoreBtn || !doc?.body?.contains?.(nativeMoreBtn)) {
                const freshEntry = resolveFreshRowEntry(sourceKey);
                nativeMoreBtn = freshEntry?.row ? findElement(depsConfig.moreBtn, freshEntry.row) : null;
            }

            return nativeMoreBtn || null;
        }

        function getNativeMenuItemMetadata(item) {
            return {
                ariaLabel: String(item?.getAttribute?.('aria-label') || '').toLowerCase(),
                testId: String(item?.getAttribute?.('data-testid') || '').toLowerCase(),
                textContent: String(item?.textContent || '').toLowerCase(),
                iconText: String(item?.querySelector?.('mat-icon, .google-symbols')?.textContent || '')
                    .trim()
                    .toLowerCase()
            };
        }

        function getNativeMenuItemFingerprint(item) {
            const { ariaLabel, testId, textContent, iconText } = getNativeMenuItemMetadata(item);
            return [ariaLabel, testId, textContent, iconText].join('||');
        }

        function queryNativeMenuItems() {
            const doc = getDocument();
            if (!doc || typeof doc.querySelectorAll !== 'function') return [];

            const seen = new Set();
            const menuItems = [];
            for (const selector of NATIVE_MENU_ITEM_SELECTORS) {
                const matches = Array.from(doc.querySelectorAll(selector));
                matches.forEach((item) => {
                    if (!item || seen.has(item)) return;
                    seen.add(item);
                    menuItems.push(item);
                });
            }
            return menuItems;
        }

        function getNativeSourceDetailsMenuItemScore(item) {
            if (!item) return false;

            const { ariaLabel, testId, textContent, iconText } = getNativeMenuItemMetadata(item);
            const haystack = `${ariaLabel} ${testId} ${textContent}`.trim();

            const negativeHints = [
                'delete',
                'remove',
                '\u5220\u9664',
                '\u79fb\u9664',
                'trash',
                'rename',
                '\u91cd\u547d\u540d',
                'download',
                '\u4e0b\u8f7d',
                'copy',
                '\u590d\u5236',
                'duplicate',
                'share',
                '\u5206\u4eab'
            ];
            if (negativeHints.some((hint) => haystack.includes(hint))) {
                return Number.NEGATIVE_INFINITY;
            }

            const strongTextHints = [
                'view source details',
                'view source detail',
                'source details',
                'source detail',
                '\u67e5\u770b\u6765\u6e90\u8be6\u60c5',
                '\u6765\u6e90\u8be6\u60c5',
                '\u67e5\u770b\u539f\u6587\u4ef6',
                '\u6253\u5f00\u539f\u6587\u4ef6',
                '\u539f\u6587\u4ef6'
            ];
            const mediumTextHints = [
                'view source',
                'open source',
                'source file',
                'original source',
                'preview source',
                '\u67e5\u770b\u6765\u6e90',
                '\u6253\u5f00\u6765\u6e90',
                '\u6765\u6e90\u6587\u4ef6',
                '\u67e5\u770b\u6765\u6e90\u6587\u4ef6',
                '\u6253\u5f00\u6765\u6e90\u6587\u4ef6'
            ];
            const weakTextHints = [
                'view details',
                'details',
                'detail',
                'preview',
                'open',
                'view',
                '\u67e5\u770b',
                '\u9884\u89c8',
                '\u6253\u5f00'
            ];
            const strongIconHints = ['description', 'details', 'article', 'visibility', 'pageview', 'preview'];
            const weakIconHints = ['info', 'info_outline', 'open_in_new', 'launch'];

            let score = 0;
            if (strongTextHints.some((hint) => haystack.includes(hint))) score += 100;
            if (mediumTextHints.some((hint) => haystack.includes(hint))) score += 60;
            if (weakTextHints.some((hint) => haystack.includes(hint))) score += 15;
            if (strongIconHints.includes(iconText)) score += 40;
            if (weakIconHints.includes(iconText)) score += 20;
            if (haystack.includes('source') || haystack.includes('\u6765\u6e90')) score += 20;
            if (haystack.includes('original') || haystack.includes('\u539f')) score += 10;

            return score;
        }

        function findNativeSourceDetailsMenuItem(menuItems) {
            let bestCandidate = null;
            let bestScore = 0;

            menuItems.forEach((item) => {
                const score = getNativeSourceDetailsMenuItemScore(item);
                if (score > bestScore) {
                    bestScore = score;
                    bestCandidate = item;
                }
            });

            if (bestCandidate) return bestCandidate;

            const safeFallbackCandidate = menuItems[0];
            if (menuItems.length === 1 && safeFallbackCandidate) {
                const fallbackScore = getNativeSourceDetailsMenuItemScore(safeFallbackCandidate);
                if (fallbackScore > Number.NEGATIVE_INFINITY) {
                    return safeFallbackCandidate;
                }
            }

            return null;
        }

        function resolveFreshSourceRow(sourceKey) {
            const source = getSourcesByKey().get(sourceKey);
            const doc = getDocument();
            if (source?.element && doc?.body?.contains?.(source.element)) {
                return source.element;
            }

            return resolveFreshRowEntry(sourceKey)?.row || null;
        }

        function createSyntheticActivationEvent(type) {
            const eventInit = {
                bubbles: true,
                cancelable: true,
                composed: true,
                button: 0,
                buttons: type.includes('down') ? 1 : 0
            };

            if (type.startsWith('pointer') && typeof PointerEvent === 'function') {
                return new PointerEvent(type, eventInit);
            }
            if (typeof MouseEvent === 'function') {
                return new MouseEvent(type, eventInit);
            }
            if (typeof Event === 'function') {
                return new Event(type, eventInit);
            }

            return { type, ...eventInit };
        }

        function dispatchSyntheticActivation(target) {
            if (!target) return false;

            let dispatched = false;

            if (typeof target.dispatchEvent === 'function') {
                ['pointerdown', 'mousedown', 'pointerup', 'mouseup'].forEach((type) => {
                    target.dispatchEvent(createSyntheticActivationEvent(type));
                });
                dispatched = true;
            }

            if (typeof target.click === 'function') {
                target.click();
                return true;
            }

            if (typeof target.dispatchEvent === 'function') {
                target.dispatchEvent(createSyntheticActivationEvent('click'));
                return true;
            }

            return dispatched;
        }

        function isSourceDetailsTargetCandidate(target) {
            if (!target) return false;

            const ariaLabel = String(target.getAttribute?.('aria-label') || '').toLowerCase();
            const role = String(target.getAttribute?.('role') || '').toLowerCase();
            const type = String(target.getAttribute?.('type') || '').toLowerCase();
            const className = String(target.className || '').toLowerCase();

            if (type === 'checkbox' || role === 'checkbox') return false;
            if (ariaLabel === 'more options') return false;
            if (className.includes('source-item-more-button')) return false;

            return typeof target.click === 'function' || typeof target.dispatchEvent === 'function';
        }

        function collectSourceDetailsCandidates(row, titleElement) {
            const selectors = [
                'a[href]',
                '[role="link"]',
                'button:not([aria-label="More options"])',
                '[role="button"]:not([aria-label="More options"])',
                '[jsaction]',
                '[tabindex]:not([tabindex="-1"])',
                '[data-testid="source-title"]',
                '.source-title',
                'mat-icon'
            ];
            const seen = new Set();
            const candidates = [];

            const append = (candidate) => {
                if (!candidate || seen.has(candidate)) return;
                seen.add(candidate);
                candidates.push(candidate);
            };

            const titleAncestor = titleElement && typeof titleElement.closest === 'function'
                ? titleElement.closest(
                    [
                        'a[href]',
                        '[role="link"]',
                        'button:not([aria-label="More options"])',
                        '[role="button"]:not([aria-label="More options"])',
                        '[jsaction]',
                        '[tabindex]:not([tabindex="-1"])'
                    ].join(', ')
                )
                : null;

            append(titleAncestor);
            append(row.querySelector?.('a[href]'));
            selectors.forEach((selector) => {
                const matches = row.querySelectorAll ? Array.from(row.querySelectorAll(selector)).slice(0, 8) : [];
                matches.forEach(append);
            });
            append(titleElement);
            append(findElement(getDEPS().icon, row));
            append(row);

            return candidates;
        }

        function getSourceDetailsTargetScore(target, row, titleElement) {
            if (!isSourceDetailsTargetCandidate(target)) {
                return Number.NEGATIVE_INFINITY;
            }

            const ariaLabel = String(target.getAttribute?.('aria-label') || '').toLowerCase();
            const role = String(target.getAttribute?.('role') || '').toLowerCase();
            const href = String(target.getAttribute?.('href') || '').toLowerCase();
            const jsaction = String(target.getAttribute?.('jsaction') || '').toLowerCase();
            const tabIndex = String(target.getAttribute?.('tabindex') || '');
            const tagName = String(target.tagName || '').toLowerCase();
            const className = String(target.className || '').toLowerCase();

            let score = 0;
            if (target === row) score += 5;
            if (target === titleElement) score += 10;
            if (className.includes('source-title')) score += 10;
            if (tagName === 'a' || href) score += 100;
            if (role === 'link') score += 90;
            if (tagName === 'button' || role === 'button') score += 80;
            if (jsaction) score += 70;
            if (tabIndex && tabIndex !== '-1') score += 50;
            if (ariaLabel && ariaLabel !== 'more options') score += 20;

            return score;
        }

        function triggerNativeSourceDetailsDirect(sourceKey) {
            const source = getSourcesByKey().get(sourceKey);
            const row = resolveFreshSourceRow(sourceKey);
            if (!source || !row) return false;

            const titleElement = findElement(getDEPS().title, row);
            const candidateTargets = collectSourceDetailsCandidates(row, titleElement)
                .map((candidate) => ({
                    candidate,
                    score: getSourceDetailsTargetScore(candidate, row, titleElement)
                }))
                .filter(({ score }) => score > Number.NEGATIVE_INFINITY)
                .sort((a, b) => b.score - a.score)
                .map(({ candidate }) => candidate);

            for (const candidate of candidateTargets) {
                if (dispatchSyntheticActivation(candidate)) {
                    return true;
                }
            }

            return false;
        }

        async function waitForNativeMenuItems(existingFingerprints = new Set(), maxAttempts = 6, delayMs = 100) {
            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                const menuItems = queryNativeMenuItems();
                const freshMenuItems = existingFingerprints.size > 0
                    ? menuItems.filter((item) => !existingFingerprints.has(getNativeMenuItemFingerprint(item)))
                    : menuItems;
                if (freshMenuItems.length > 0) {
                    return freshMenuItems;
                }
                if (attempt < maxAttempts - 1) {
                    await new Promise((resolve) => setTimeout(resolve, delayMs));
                }
            }
            return [];
        }

        async function triggerNativeSourceDetailsViaNativeMenu(sourceKey) {
            const nativeMoreBtn = findNativeSourceMenuButton(sourceKey);
            if (!nativeMoreBtn || typeof nativeMoreBtn.click !== 'function') {
                return false;
            }

            const existingMenuFingerprints = new Set(
                queryNativeMenuItems().map((item) => getNativeMenuItemFingerprint(item))
            );
            nativeMoreBtn.click();

            try {
                const menuItems = await waitForNativeMenuItems(existingMenuFingerprints);
                const detailsMenuItem = findNativeSourceDetailsMenuItem(menuItems);
                if (!detailsMenuItem || typeof detailsMenuItem.click !== 'function') {
                    const doc = getDocument();
                    doc?.body?.click?.();
                    return triggerNativeSourceDetailsDirect(sourceKey);
                }

                detailsMenuItem.click();
                return true;
            } catch (error) {
                console.error('NotebookLM Source Management: Failed to bridge native source details action.', error);
                const doc = getDocument();
                doc?.body?.click?.();
                return triggerNativeSourceDetailsDirect(sourceKey);
            }
        }

        function triggerNativeSourceMenu(sourceKey) {
            const nativeBtn = findNativeSourceMenuButton(sourceKey);
            if (!nativeBtn) return false;

            nativeBtn.click();
            return true;
        }

        function openNativeSourceDetails(sourceKey) {
            Promise.resolve(triggerNativeSourceDetailsDirect(sourceKey))
                .then((didOpen) => {
                    if (didOpen) {
                        markSourceDetailViewRequested();
                    } else {
                        showToast(getMessage('ui_source_details_unavailable'));
                    }
                })
                .catch((error) => {
                    console.error('NotebookLM Source Management: Source details open request failed.', error);
                    showToast(getMessage('ui_source_details_unavailable'));
                });

            return true;
        }

        function resetSourceActionInvokers() {
            sourceActionInvokers = Object.create(null);
            sourceActionInvokers.openNativeDetails = (sourceKey) => openNativeSourceDetails(sourceKey);
            sourceActionInvokers.openTags = (sourceKey) => renderTagModal(sourceKey);
            sourceActionInvokers.moveToFolder = (sourceKey) => renderMoveToFolderModal(sourceKey);
            sourceActionInvokers.openNativeMenu = (sourceKey) => triggerNativeSourceMenu(sourceKey);
            return sourceActionInvokers;
        }

        function getSourceActionInvokers() {
            return sourceActionInvokers;
        }

        function setSourceActionInvoker(name, fn) {
            if (name && typeof fn === 'function' && Object.prototype.hasOwnProperty.call(sourceActionInvokers, name)) {
                sourceActionInvokers[name] = fn;
            }
            return sourceActionInvokers;
        }

        function setSourceActionInvokers(nextInvokers = {}) {
            if (!nextInvokers || typeof nextInvokers !== 'object') return sourceActionInvokers;
            Object.entries(nextInvokers).forEach(([name, fn]) => {
                setSourceActionInvoker(name, fn);
            });
            return sourceActionInvokers;
        }

        function handleSourceActionSelection(sourceKey, action) {
            const source = getSourcesByKey().get(sourceKey);
            if (!sourceKey || !canOpenSourceActionMenu(source)) {
                closeSourceActionMenu();
                return false;
            }

            if (action === 'view-source') {
                activeSourceActionSubmenuAction = activeSourceActionSubmenuAction === action ? null : action;
                return true;
            }

            closeSourceActionMenu();

            switch (action) {
            case 'view-source-details': {
                const didOpen = sourceActionInvokers.openNativeDetails(sourceKey);
                if (didOpen === false) {
                    showToast(getMessage('ui_source_details_unavailable'));
                    return false;
                }
                return true;
            }
            case 'tags':
                sourceActionInvokers.openTags(sourceKey);
                return true;
            case 'move':
                sourceActionInvokers.moveToFolder(sourceKey);
                return true;
            case 'native-more':
                return sourceActionInvokers.openNativeMenu(sourceKey);
            default:
                return false;
            }
        }

        resetSourceActionInvokers();

        return {
            canOpenSourceActionMenu,
            getViewportSize,
            findSourceActionButton,
            getSourceActionMenuItems,
            getSourceActionSubmenuItems,
            getSourceActionMenuHeight,
            getSourceActionMenuPosition,
            getSourceActionSubmenuPosition,
            closeSourceActionMenu,
            dismissSourceActionMenuAndRender,
            toggleSourceActionMenu,
            syncActiveSourceActionMenuState,
            findNativeSourceMenuButton,
            getNativeMenuItemMetadata,
            getNativeMenuItemFingerprint,
            queryNativeMenuItems,
            getNativeSourceDetailsMenuItemScore,
            findNativeSourceDetailsMenuItem,
            resolveFreshSourceRow,
            createSyntheticActivationEvent,
            dispatchSyntheticActivation,
            isSourceDetailsTargetCandidate,
            collectSourceDetailsCandidates,
            getSourceDetailsTargetScore,
            triggerNativeSourceDetailsDirect,
            waitForNativeMenuItems,
            triggerNativeSourceDetailsViaNativeMenu,
            triggerNativeSourceMenu,
            openNativeSourceDetails,
            handleSourceActionSelection,
            getSourceActionInvokers,
            setSourceActionInvoker,
            setSourceActionInvokers,
            resetSourceActionInvokers,
            getActiveSourceActionSourceKey: () => activeSourceActionSourceKey,
            setActiveSourceActionSourceKey: (value) => {
                activeSourceActionSourceKey = value || null;
                return activeSourceActionSourceKey;
            },
            getActiveSourceActionSubmenuAction: () => activeSourceActionSubmenuAction,
            setActiveSourceActionSubmenuAction: (value) => {
                activeSourceActionSubmenuAction = value || null;
                return activeSourceActionSubmenuAction;
            },
            getSourceActionMenuPositionState: () => sourceActionMenuPosition,
            setSourceActionMenuPosition: (value) => {
                sourceActionMenuPosition = value || null;
                return sourceActionMenuPosition;
            }
        };
    }

    globalThis.NSM_CREATE_CONTENT_SOURCE_ACTIONS = createContentSourceActions;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentSourceActions;
    }
})();
