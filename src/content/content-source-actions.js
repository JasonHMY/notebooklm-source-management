(function () {
    'use strict';

    function createContentSourceActions(deps = {}) {
        const runtime = deps.runtime && typeof deps.runtime === 'object' ? deps.runtime : deps;
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
        const extractSourceIdentitySnapshot = typeof deps.extractSourceIdentitySnapshot === 'function'
            ? deps.extractSourceIdentitySnapshot
            : () => null;
        const getSourceElements = typeof deps.getSourceElements === 'function'
            ? deps.getSourceElements
            : null;
        const renderTagModal = typeof deps.renderTagModal === 'function'
            ? deps.renderTagModal
            : () => false;
        const renderMoveToFolderModal = typeof deps.renderMoveToFolderModal === 'function'
            ? deps.renderMoveToFolderModal
            : () => false;
        const canMoveSourceToUngrouped = typeof deps.canMoveSourceToUngrouped === 'function'
            ? deps.canMoveSourceToUngrouped
            : () => false;
        const moveSourceToUngrouped = typeof deps.moveSourceToUngrouped === 'function'
            ? deps.moveSourceToUngrouped
            : () => false;
        const markSourceDetailViewRequested = typeof deps.markSourceDetailViewRequested === 'function'
            ? deps.markSourceDetailViewRequested
            : () => {};
        const onNativeSourceRenameStarted = typeof deps.onNativeSourceRenameStarted === 'function'
            ? deps.onNativeSourceRenameStarted
            : () => {};
        const recordNativeActionFailure = typeof deps.recordNativeActionFailure === 'function'
            ? deps.recordNativeActionFailure
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
        const NATIVE_DIALOG_SELECTORS = [
            'mat-dialog-container',
            '[role="dialog"]',
            '.cdk-dialog-container'
        ];
        const NATIVE_DELETE_ICON_HINTS = new Set(['delete', 'delete_forever', 'remove_circle']);
        const NATIVE_RENAME_ICON_HINTS = new Set(['edit', 'edit_note', 'drive_file_rename_outline']);
        const NATIVE_DELETE_TEXT_PATTERN = /delete|remove|trash|删除|移除|supprimer|löschen|eliminar|削除|삭제/i;
        const NATIVE_RENAME_TEXT_PATTERN = /rename|rename source|edit title|edit name|重命名|重命名来源|renombrar|renombrar fuente|umbenennen|renommer|名前を変更|이름 바꾸기|이름 변경/i;
        const NATIVE_CANCEL_TEXT_PATTERN = /cancel|取消|annuler|abbrechen|cancelar|キャンセル|취소/i;
        const NATIVE_CONFIRM_TEXT_PATTERN = /delete|remove|削除|삭제|删除|移除|supprimer|löschen|eliminar|yes|ok|confirm|确定|确认/i;
        const NATIVE_MORE_MENU_TEXT_PATTERN = /more|options|menu|更多|选项|選項|菜单|菜單|más|mas|opciones|mehr|optionen|plus|options|その他|옵션/i;
        const NATIVE_MORE_ICON_HINTS = new Set(['more_vert', 'more_horiz', 'more', 'overflow_menu']);
        const NATIVE_ACTION_BASE_MESSAGE_KEYS = {
            details: 'ui_source_details_failed',
            rename: 'ui_rename_source_failed',
            delete: 'ui_delete_source_failed'
        };
        const NATIVE_ACTION_REASON_MESSAGE_KEYS = {
            source_missing: 'ui_native_action_source_unavailable',
            source_unavailable: 'ui_native_action_source_unavailable',
            source_row_missing: 'ui_native_action_source_unavailable',
            details_target_missing: 'ui_native_action_menu_item_missing',
            menu_button_missing: 'ui_native_action_menu_button_missing',
            details_menu_missing: 'ui_native_action_menu_item_missing',
            rename_menu_missing: 'ui_native_action_menu_item_missing',
            delete_menu_missing: 'ui_native_action_menu_item_missing',
            confirm_dialog_missing: 'ui_native_action_confirm_dialog_missing',
            confirm_dialog_unmatched: 'ui_native_action_confirm_dialog_missing',
            confirm_dialog_ambiguous: 'ui_native_action_confirm_dialog_missing',
            confirm_dialog_mismatched_source: 'ui_native_action_confirm_dialog_missing',
            confirm_button_missing: 'ui_native_action_confirm_button_missing',
            delete_not_confirmed: 'ui_native_action_failed',
            source_row_mismatch: 'ui_native_action_source_unavailable',
            native_action_error: 'ui_native_action_failed',
            native_delete_error: 'ui_native_action_failed'
        };

        function canOpenSourceActionMenu(source) {
            const state = getState() || {};
            return Boolean(source && !state.isBatchMode && !source.isLoading && !source.isDisabled);
        }

        function createNativeActionResult(ok, reason = '') {
            return ok ? { ok: true } : { ok: false, reason: reason || 'native_action_error' };
        }

        function markNativeSourceDeleted(sourceKey) {
            if (!sourceKey) return;
            if (!(runtime.recentNativeDeletedSourceKeys instanceof Set)) {
                runtime.recentNativeDeletedSourceKeys = new Set();
            }
            runtime.recentNativeDeletedSourceKeys.add(sourceKey);
        }

        function getNativeActionFailureMessage(action, reason) {
            const baseKey = NATIVE_ACTION_BASE_MESSAGE_KEYS[action] || 'ui_native_action_failed';
            const reasonKey = NATIVE_ACTION_REASON_MESSAGE_KEYS[reason] || 'ui_native_action_failed';
            const baseMessage = getMessage(baseKey);
            const reasonMessage = getMessage(reasonKey);
            if (!reasonMessage || reasonMessage === reasonKey || reasonMessage === baseMessage) {
                return baseMessage;
            }
            return `${baseMessage} ${reasonMessage}`;
        }

        function showNativeActionFailureToast(action, sourceKey, reason, retryHandler) {
            recordNativeActionFailure({
                action,
                sourceKey,
                reason: reason || 'native_action_error',
                retryable: typeof retryHandler === 'function'
            });
            const retry = typeof retryHandler === 'function' ? retryHandler : null;
            showToast(getNativeActionFailureMessage(action, reason), {
                variant: 'error',
                actionLabel: getMessage('ui_retry'),
                onAction: retry ? () => retry(sourceKey) : null
            });
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
                    action: 'view-source-details',
                    kind: 'action',
                    icon: 'description',
                    label: getMessage('ui_view_source_details')
                },
                {
                    action: 'rename-source',
                    kind: 'action',
                    icon: 'edit',
                    label: getMessage('ui_rename_source')
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
                    action: 'move-ungrouped',
                    kind: 'action',
                    icon: 'drive_file_move_rtl',
                    label: getMessage('ui_move_to_ungrouped'),
                    disabled: !canMoveSourceToUngrouped(sourceKey)
                },
                {
                    action: 'delete-source',
                    kind: 'action',
                    icon: 'delete',
                    label: getMessage('ui_delete_source')
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

        function getNativeMoreButtonCandidateScore(candidate) {
            if (!candidate) return Number.NEGATIVE_INFINITY;

            const tagName = String(candidate.tagName || '').toLowerCase();
            const role = String(candidate.getAttribute?.('role') || '').toLowerCase();
            const type = String(candidate.getAttribute?.('type') || '').toLowerCase();
            if (tagName === 'input' && type === 'checkbox') return Number.NEGATIVE_INFINITY;

            const ariaLabel = String(candidate.getAttribute?.('aria-label') || '').toLowerCase();
            const title = String(candidate.getAttribute?.('title') || '').toLowerCase();
            const testId = String(candidate.getAttribute?.('data-testid') || '').toLowerCase();
            const ariaHasPopup = String(candidate.getAttribute?.('aria-haspopup') || '').toLowerCase();
            const className = String(candidate.className || '').toLowerCase();
            const iconText = String(candidate.querySelector?.('mat-icon, .google-symbols')?.textContent || '')
                .trim()
                .toLowerCase();
            const textContent = String(candidate.textContent || '').toLowerCase();
            const haystack = `${ariaLabel} ${title} ${testId} ${className} ${textContent}`.trim();

            let score = Number.NEGATIVE_INFINITY;
            const add = (value) => {
                score = score === Number.NEGATIVE_INFINITY ? value : score + value;
            };

            if (NATIVE_MORE_ICON_HINTS.has(iconText)) add(100);
            if (NATIVE_MORE_MENU_TEXT_PATTERN.test(haystack)) add(80);
            if (ariaHasPopup && ariaHasPopup !== 'false') add(50);
            if (className.includes('source-item-more-button')) add(50);
            if (testId.includes('more') || testId.includes('menu') || testId.includes('overflow')) add(50);
            if (tagName === 'button' || role === 'button') add(20);

            return score;
        }

        function findNativeMoreButtonInRow(row) {
            if (!row) return null;

            const depsConfig = getDEPS();
            const directMatch = findElement(depsConfig.moreBtn, row);
            if (directMatch && typeof directMatch.click === 'function') {
                return directMatch;
            }

            const candidates = [];
            const appendCandidate = (candidate) => {
                if (!candidate || candidates.includes(candidate)) return;
                candidates.push(candidate);
            };

            [
                'button',
                '[role="button"]',
                '[aria-haspopup]',
                '[mat-icon-button]',
                '.mat-mdc-icon-button',
                '.mat-icon-button'
            ].forEach((selector) => {
                try {
                    const matches = row.querySelectorAll ? Array.from(row.querySelectorAll(selector)).slice(0, 12) : [];
                    matches.forEach(appendCandidate);
                } catch (error) {
                    // Ignore unsupported selector variants in test or older DOM contexts.
                }
            });

            return candidates
                .map((candidate) => ({
                    candidate,
                    score: typeof candidate.click === 'function'
                        ? getNativeMoreButtonCandidateScore(candidate)
                        : Number.NEGATIVE_INFINITY
                }))
                .filter(({ score }) => score > Number.NEGATIVE_INFINITY)
                .sort((left, right) => right.score - left.score)[0]?.candidate || null;
        }

        function findNativeSourceMenuButton(sourceKey) {
            const source = getSourcesByKey().get(sourceKey);
            if (!source) return null;

            const doc = getDocument();
            const freshEntry = resolveFreshRowEntry(sourceKey);
            let nativeMoreBtn = freshEntry?.row ? findNativeMoreButtonInRow(freshEntry.row) : null;
            if (!nativeMoreBtn && source.element && doc?.body?.contains?.(source.element)) {
                nativeMoreBtn = findNativeMoreButtonInRow(source.element);
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

        function queryNativeDialogs() {
            const doc = getDocument();
            if (!doc || typeof doc.querySelectorAll !== 'function') return [];

            const seen = new Set();
            const dialogs = [];
            const selector = NATIVE_DIALOG_SELECTORS.join(', ');
            Array.from(doc.querySelectorAll(selector)).forEach((dialog) => {
                if (!dialog || seen.has(dialog)) return;
                if (!isNativeDialogVisible(dialog)) return;
                seen.add(dialog);
                dialogs.push(dialog);
            });
            return dialogs;
        }

        function isNativeDialogVisible(dialog) {
            if (!dialog) return false;

            const win = getWindow();
            let current = dialog;
            while (current) {
                if (current.hidden || current.getAttribute?.('hidden') != null) return false;
                if (current.getAttribute?.('aria-hidden') === 'true') return false;
                if (current.getAttribute?.('inert') != null) return false;
                const style = typeof win?.getComputedStyle === 'function'
                    ? win.getComputedStyle(current)
                    : null;
                if (style) {
                    if (style.display === 'none') return false;
                    if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
                }
                current = current.parentElement || null;
            }

            return true;
        }

        function getNativeDialogMetadata(dialog) {
            const buttons = dialog?.querySelectorAll ? Array.from(dialog.querySelectorAll('button')) : [];
            const buttonText = buttons.map((button) => ([
                button?.textContent,
                button?.getAttribute?.('aria-label'),
                button?.getAttribute?.('title'),
                button?.querySelector?.('mat-icon, .google-symbols')?.textContent
            ].filter(Boolean).join(' '))).join(' ');

            return {
                ariaLabel: String(dialog?.getAttribute?.('aria-label') || '').toLowerCase(),
                title: String(dialog?.getAttribute?.('title') || '').toLowerCase(),
                textContent: String(dialog?.textContent || '').toLowerCase(),
                buttonText: String(buttonText || '').toLowerCase()
            };
        }

        function getNativeDialogFingerprint(dialog) {
            const { ariaLabel, title, textContent, buttonText } = getNativeDialogMetadata(dialog);
            return [ariaLabel, title, textContent, buttonText].join('||');
        }

        function isNativeDeleteConfirmDialog(dialog) {
            const { ariaLabel, title, textContent, buttonText } = getNativeDialogMetadata(dialog);
            return NATIVE_DELETE_TEXT_PATTERN.test([ariaLabel, title, textContent, buttonText].join(' '));
        }

        function findNativeDeleteConfirmDialogs(dialogs = []) {
            const dialogList = Array.isArray(dialogs) ? dialogs : Array.from(dialogs || []);
            return dialogList.filter((dialog) => isNativeDeleteConfirmDialog(dialog));
        }

        function getNativeDeleteMenuItemScore(item) {
            if (!item) return Number.NEGATIVE_INFINITY;

            const { ariaLabel, testId, textContent, iconText } = getNativeMenuItemMetadata(item);
            if (NATIVE_DELETE_ICON_HINTS.has(iconText)) return 100;
            if (
                ariaLabel.includes('delete') ||
                ariaLabel.includes('remove') ||
                ariaLabel.includes('trash') ||
                testId.includes('delete') ||
                testId.includes('remove') ||
                testId.includes('trash')
            ) {
                return 90;
            }
            if (NATIVE_DELETE_TEXT_PATTERN.test(textContent)) return 60;
            return Number.NEGATIVE_INFINITY;
        }

        function getNativeRenameMenuItemScore(item) {
            if (!item) return Number.NEGATIVE_INFINITY;

            const { ariaLabel, testId, textContent, iconText } = getNativeMenuItemMetadata(item);
            const haystack = `${ariaLabel} ${testId} ${textContent}`.trim();
            if (NATIVE_RENAME_ICON_HINTS.has(iconText)) return 100;
            if (
                haystack.includes('rename') ||
                haystack.includes('edit-title') ||
                haystack.includes('edit title') ||
                haystack.includes('edit-name') ||
                haystack.includes('edit name') ||
                haystack.includes('重命名')
            ) {
                return 90;
            }
            if (NATIVE_RENAME_TEXT_PATTERN.test(textContent)) return 70;
            return Number.NEGATIVE_INFINITY;
        }

        function scoreNativeMenuItemAction(action, item) {
            switch (action) {
            case 'delete':
                return getNativeDeleteMenuItemScore(item);
            case 'rename':
                return getNativeRenameMenuItemScore(item);
            case 'source-details':
                return getNativeSourceDetailsMenuItemScore(item);
            default:
                return Number.NEGATIVE_INFINITY;
            }
        }

        function findNativeActionMenuItem(menuItems = [], action, options = {}) {
            const items = Array.isArray(menuItems) ? menuItems : Array.from(menuItems || []);
            const minimumScore = Number.isFinite(options.minimumScore) ? options.minimumScore : 0;
            let bestCandidate = null;
            let bestScore = Number.NEGATIVE_INFINITY;

            items.forEach((item) => {
                const score = scoreNativeMenuItemAction(action, item);
                if (score > bestScore) {
                    bestScore = score;
                    bestCandidate = item;
                }
            });

            if (bestCandidate && bestScore > minimumScore) {
                return bestCandidate;
            }

            if (options.allowSingleSafeFallback && items.length === 1 && items[0]) {
                const fallbackScore = scoreNativeMenuItemAction(action, items[0]);
                if (fallbackScore > Number.NEGATIVE_INFINITY) {
                    return items[0];
                }
            }

            return null;
        }

        function findNativeDeleteMenuItem(menuItems = []) {
            return findNativeActionMenuItem(menuItems, 'delete');
        }

        function findNativeRenameMenuItem(menuItems = []) {
            return findNativeActionMenuItem(menuItems, 'rename');
        }

        function findNativeDeleteConfirmButton(dialogs = []) {
            const dialogList = findNativeDeleteConfirmDialogs(dialogs);

            for (const dialog of dialogList) {
                const buttons = dialog?.querySelectorAll ? Array.from(dialog.querySelectorAll('button')) : [];
                let fallbackButton = null;

                for (const button of buttons) {
                    const text = String(button?.textContent || '').toLowerCase();
                    const ariaLabel = String(button?.getAttribute?.('aria-label') || '').toLowerCase();
                    if (NATIVE_CANCEL_TEXT_PATTERN.test(text) || NATIVE_CANCEL_TEXT_PATTERN.test(ariaLabel)) {
                        continue;
                    }

                    const className = String(button?.className || '').toLowerCase();
                    const iconText = String(button?.querySelector?.('mat-icon, .google-symbols')?.textContent || '')
                        .trim()
                        .toLowerCase();
                    const isPrimaryButton = className.includes('primary') || className.includes('warn');
                    const hasCheckIcon = iconText === 'check';
                    const hasConfirmText = NATIVE_CONFIRM_TEXT_PATTERN.test(text) || NATIVE_CONFIRM_TEXT_PATTERN.test(ariaLabel);

                    if (isPrimaryButton || hasCheckIcon || hasConfirmText) {
                        return button;
                    }

                    if (!fallbackButton && (className.includes('primary') || className.includes('warn'))) {
                        fallbackButton = button;
                    }
                }

                if (fallbackButton) {
                    return fallbackButton;
                }
            }

            return null;
        }

        async function waitForNativeDialogs(existingFingerprints = new Set(), maxAttempts = 6, delayMs = 100) {
            let dialogFingerprints = existingFingerprints;
            let attempts = maxAttempts;
            let delay = delayMs;

            if (typeof existingFingerprints === 'number') {
                dialogFingerprints = new Set();
                attempts = existingFingerprints;
                delay = maxAttempts;
            }
            if (!(dialogFingerprints instanceof Set)) {
                dialogFingerprints = new Set();
            }

            for (let attempt = 0; attempt < attempts; attempt++) {
                const dialogs = queryNativeDialogs();
                const freshDialogs = dialogFingerprints.size > 0
                    ? dialogs.filter((dialog) => !dialogFingerprints.has(getNativeDialogFingerprint(dialog)))
                    : dialogs;
                if (freshDialogs.length > 0) {
                    return freshDialogs;
                }
                if (attempt < attempts - 1) {
                    await new Promise((resolve) => setTimeout(resolve, delay));
                }
            }
            return [];
        }

        async function waitForNativeDialogsToClose(dialogs = [], maxAttempts = 8, delayMs = 100) {
            const dialogList = Array.isArray(dialogs) ? dialogs : Array.from(dialogs || []);
            if (dialogList.length === 0) return true;

            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                const openDialogs = queryNativeDialogs();
                const hasOpenDialog = dialogList.some((dialog) => openDialogs.includes(dialog));
                if (!hasOpenDialog) {
                    return true;
                }
                if (attempt < maxAttempts - 1) {
                    await new Promise((resolve) => setTimeout(resolve, delayMs));
                }
            }
            return false;
        }

        function normalizeNativeSourceText(value) {
            return String(value || '')
                .trim()
                .replace(/\s+/g, ' ')
                .toLowerCase();
        }

        function getSourceComparableTitle(source) {
            return normalizeNativeSourceText(source?.normalizedTitle || source?.title || source?.ariaLabel || '');
        }

        function hasComparableSourceIdentity(source) {
            return Boolean(source && (
                source.stableToken ||
                source.fingerprint ||
                getSourceComparableTitle(source)
            ));
        }

        function getNativeRowIdentity(row) {
            if (!row) return null;
            try {
                return extractSourceIdentitySnapshot(row);
            } catch (error) {
                return null;
            }
        }

        function doesNativeRowMatchSource(source, row, identity = null) {
            if (!source || !row) return false;
            if (!hasComparableSourceIdentity(source)) return true;

            const rowIdentity = identity || getNativeRowIdentity(row);
            if (!rowIdentity) return false;

            if (source.stableToken && rowIdentity.stableToken === source.stableToken) {
                return true;
            }
            if (source.fingerprint && rowIdentity.fingerprint === source.fingerprint) {
                return true;
            }
            if (source.stableToken || source.fingerprint) {
                return false;
            }

            const sourceTitle = getSourceComparableTitle(source);
            return Boolean(sourceTitle && rowIdentity.normalizedTitle === sourceTitle);
        }

        function resolveValidatedNativeSourceRow(sourceKey) {
            const source = getSourcesByKey().get(sourceKey);
            if (!source) return { row: null, reason: 'source_missing' };

            const freshEntry = resolveFreshRowEntry(sourceKey);
            if (freshEntry?.row && doesNativeRowMatchSource(source, freshEntry.row, freshEntry.identity)) {
                return { row: freshEntry.row, identity: freshEntry.identity || null };
            }

            const doc = getDocument();
            if (source.element && doc?.body?.contains?.(source.element)) {
                const identity = getNativeRowIdentity(source.element);
                if (doesNativeRowMatchSource(source, source.element, identity)) {
                    return { row: source.element, identity };
                }
                return { row: null, reason: 'source_row_mismatch' };
            }

            if (hasComparableSourceIdentity(source) && queryNativeSourceRows().length > 0) {
                return { row: null, reason: 'source_row_mismatch' };
            }

            return { row: null, reason: 'source_row_missing' };
        }

        function getDialogSourceTitleMatchState(dialog, source) {
            const targetTitle = getSourceComparableTitle(source);
            if (!targetTitle) return 'unknown';

            const metadata = getNativeDialogMetadata(dialog);
            const dialogText = normalizeNativeSourceText([
                metadata.ariaLabel,
                metadata.title,
                metadata.textContent,
                metadata.buttonText
            ].filter(Boolean).join(' '));

            if (dialogText.includes(targetTitle)) {
                return 'match';
            }

            for (const otherSource of getSourcesByKey().values()) {
                if (!otherSource || otherSource.key === source?.key) continue;
                const otherTitle = getSourceComparableTitle(otherSource);
                if (otherTitle && otherTitle.length >= 3 && dialogText.includes(otherTitle)) {
                    return 'mismatch';
                }
            }

            return 'unknown';
        }

        function filterNativeDeleteConfirmDialogsForSource(dialogs, source) {
            const confirmDialogs = findNativeDeleteConfirmDialogs(dialogs);
            const matchingDialogs = [];
            const unknownDialogs = [];
            const mismatchedDialogs = [];

            confirmDialogs.forEach((dialog) => {
                const matchState = getDialogSourceTitleMatchState(dialog, source);
                if (matchState === 'match') {
                    matchingDialogs.push(dialog);
                } else if (matchState === 'mismatch') {
                    mismatchedDialogs.push(dialog);
                } else {
                    unknownDialogs.push(dialog);
                }
            });

            if (matchingDialogs.length === 1) {
                return { dialogs: matchingDialogs, reason: '' };
            }
            if (matchingDialogs.length > 1) {
                return { dialogs: [], reason: 'confirm_dialog_ambiguous' };
            }
            if (mismatchedDialogs.length > 0 && unknownDialogs.length === 0) {
                return { dialogs: [], reason: 'confirm_dialog_mismatched_source' };
            }
            if (unknownDialogs.length > 1 || mismatchedDialogs.length > 1) {
                return { dialogs: [], reason: 'confirm_dialog_ambiguous' };
            }
            if (unknownDialogs.length === 1 && mismatchedDialogs.length === 0) {
                return { dialogs: unknownDialogs, reason: '' };
            }
            if (mismatchedDialogs.length === 1) {
                return { dialogs: [], reason: 'confirm_dialog_mismatched_source' };
            }

            return { dialogs: [], reason: '' };
        }

        async function waitForNativeDeleteConfirmTarget(existingDialogs = new Set(), source = null, maxAttempts = 10, delayMs = 100) {
            const existingDialogSet = existingDialogs instanceof Set
                ? existingDialogs
                : new Set(Array.from(existingDialogs || []));
            let visibleDialogs = [];
            let candidateDialogs = [];
            let confirmDialogs = [];
            let reason = '';

            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                visibleDialogs = queryNativeDialogs();
                candidateDialogs = visibleDialogs.filter((dialog) => !existingDialogSet.has(dialog));
                const filterResult = filterNativeDeleteConfirmDialogsForSource(candidateDialogs, source);
                confirmDialogs = filterResult.dialogs;
                reason = filterResult.reason;
                if (reason) {
                    return {
                        visibleDialogs,
                        candidateDialogs,
                        confirmDialogs,
                        confirmButton: null,
                        reason
                    };
                }
                const confirmButton = findNativeDeleteConfirmButton(confirmDialogs);
                if (confirmButton) {
                    return {
                        visibleDialogs,
                        candidateDialogs,
                        confirmDialogs,
                        confirmButton,
                        reason: ''
                    };
                }
                if (attempt < maxAttempts - 1) {
                    await new Promise((resolve) => setTimeout(resolve, delayMs));
                }
            }

            return {
                visibleDialogs,
                candidateDialogs,
                confirmDialogs,
                confirmButton: null,
                reason
            };
        }

        function closeNativeOverlay() {
            const doc = getDocument();
            doc?.body?.click?.();
        }

        function getNativeSourceDetailsMenuItemScore(item) {
            if (!item) return Number.NEGATIVE_INFINITY;

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
            return findNativeActionMenuItem(menuItems, 'source-details', {
                allowSingleSafeFallback: true
            });
        }

        function resolveFreshSourceRow(sourceKey) {
            const source = getSourcesByKey().get(sourceKey);
            const doc = getDocument();
            const freshRow = resolveFreshRowEntry(sourceKey)?.row || null;
            if (freshRow) {
                return freshRow;
            }

            if (source?.element && doc?.body?.contains?.(source.element)) {
                return source.element;
            }

            return null;
        }

        function queryNativeSourceRows() {
            const doc = getDocument();
            if (!doc || typeof doc.querySelectorAll !== 'function') return [];

            if (typeof getSourceElements === 'function') {
                try {
                    const seenAdapterRows = new Set();
                    const adapterRows = Array.from(getSourceElements() || [])
                        .filter((row) => {
                            if (!row || seenAdapterRows.has(row)) return false;
                            seenAdapterRows.add(row);
                            return true;
                        });
                    if (adapterRows.length > 0) return adapterRows;
                } catch (error) {
                    // Fall back to legacy selectors if the source adapter is unavailable during teardown.
                }
            }

            const selectors = Array.isArray(getDEPS().row)
                ? getDEPS().row
                : [getDEPS().row];
            const seen = new Set();
            const rows = [];
            selectors
                .filter((selector) => typeof selector === 'string' && selector.trim())
                .forEach((selector) => {
                    try {
                        Array.from(doc.querySelectorAll(selector)).forEach((row) => {
                            if (!row || seen.has(row)) return;
                            seen.add(row);
                            rows.push(row);
                        });
                    } catch (error) {
                        // Ignore unsupported selector variants in test or older DOM contexts.
                    }
                });
            return rows;
        }

        function isElementInDocument(element) {
            if (!element) return false;
            const doc = getDocument();
            if (doc?.body && typeof doc.body.contains === 'function') {
                return doc.body.contains(element);
            }
            return Boolean(element.isConnected);
        }

        async function waitForNativeSourceRowRemoval(sourceKey, originalRow = null, originalRowCount = 0, maxAttempts = 10, delayMs = 100) {
            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                const freshRow = resolveFreshSourceRow(sourceKey);
                const sourceRows = queryNativeSourceRows();
                const listShrank = originalRowCount > 0 && sourceRows.length < originalRowCount;
                if (!freshRow || !isElementInDocument(freshRow)) {
                    return true;
                }
                if (originalRow && !isElementInDocument(originalRow)) {
                    return true;
                }
                if (listShrank) {
                    return true;
                }
                if (attempt < maxAttempts - 1) {
                    await new Promise((resolve) => setTimeout(resolve, delayMs));
                }
            }
            return false;
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

        function triggerNativeSourceDetailsDirectWithResult(sourceKey) {
            const source = getSourcesByKey().get(sourceKey);
            const row = resolveFreshSourceRow(sourceKey);
            if (!source || source.isDisabled || source.isLoading) {
                return createNativeActionResult(false, 'source_unavailable');
            }
            if (!row) {
                return createNativeActionResult(false, 'source_row_missing');
            }

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
                    return createNativeActionResult(true);
                }
            }

            return createNativeActionResult(false, 'details_target_missing');
        }

        function triggerNativeSourceDetailsDirect(sourceKey) {
            return triggerNativeSourceDetailsDirectWithResult(sourceKey).ok;
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

        async function triggerNativeSourceDetailsViaNativeMenuWithResult(sourceKey) {
            const source = getSourcesByKey().get(sourceKey);
            if (!source || source.isDisabled || source.isLoading) {
                return createNativeActionResult(false, 'source_unavailable');
            }
            const nativeMoreBtn = findNativeSourceMenuButton(sourceKey);
            if (!nativeMoreBtn || typeof nativeMoreBtn.click !== 'function') {
                return createNativeActionResult(false, 'menu_button_missing');
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
                    const directResult = triggerNativeSourceDetailsDirectWithResult(sourceKey);
                    return directResult.ok ? directResult : createNativeActionResult(false, 'details_menu_missing');
                }

                detailsMenuItem.click();
                return createNativeActionResult(true);
            } catch (error) {
                console.error('NotebookLM Source Management: Failed to bridge native source details action.', error);
                const doc = getDocument();
                doc?.body?.click?.();
                const directResult = triggerNativeSourceDetailsDirectWithResult(sourceKey);
                return directResult.ok ? directResult : createNativeActionResult(false, 'native_action_error');
            }
        }

        async function triggerNativeSourceDetailsViaNativeMenu(sourceKey) {
            const result = await triggerNativeSourceDetailsViaNativeMenuWithResult(sourceKey);
            return Boolean(result && result.ok);
        }

        async function triggerNativeSourceRenameWithResult(sourceKey) {
            const source = getSourcesByKey().get(sourceKey);
            if (!source || source.isDisabled || source.isLoading) {
                return createNativeActionResult(false, 'source_unavailable');
            }

            const rowResult = resolveValidatedNativeSourceRow(sourceKey);
            if (!rowResult.row) {
                return createNativeActionResult(false, rowResult.reason || 'source_row_missing');
            }
            const nativeMoreBtn = findNativeMoreButtonInRow(rowResult.row);
            if (!nativeMoreBtn || typeof nativeMoreBtn.click !== 'function') {
                return createNativeActionResult(false, 'menu_button_missing');
            }

            const existingMenuFingerprints = new Set(
                queryNativeMenuItems().map((item) => getNativeMenuItemFingerprint(item))
            );
            nativeMoreBtn.click();

            try {
                const menuItems = await waitForNativeMenuItems(existingMenuFingerprints);
                const renameMenuItem = findNativeRenameMenuItem(menuItems);
                if (!renameMenuItem || typeof renameMenuItem.click !== 'function') {
                    closeNativeOverlay();
                    return createNativeActionResult(false, 'rename_menu_missing');
                }

                renameMenuItem.click();
                onNativeSourceRenameStarted(sourceKey);
                return createNativeActionResult(true);
            } catch (error) {
                console.error('NotebookLM Source Management: Failed to bridge native source rename action.', error);
                closeNativeOverlay();
                return createNativeActionResult(false, 'native_action_error');
            }
        }

        async function triggerNativeSourceRename(sourceKey) {
            const result = await triggerNativeSourceRenameWithResult(sourceKey);
            return Boolean(result && result.ok);
        }

        async function deleteNativeSource(sourceKey) {
            const source = getSourcesByKey().get(sourceKey);
            if (!source) {
                return { deleted: false, reason: 'source_missing' };
            }
            if (source.isDisabled || source.isLoading) {
                return { deleted: false, reason: 'source_unavailable' };
            }

            const rowResult = resolveValidatedNativeSourceRow(sourceKey);
            if (!rowResult.row) {
                return { deleted: false, reason: rowResult.reason || 'source_row_missing' };
            }
            const nativeMoreBtn = findNativeMoreButtonInRow(rowResult.row);
            if (!nativeMoreBtn || typeof nativeMoreBtn.click !== 'function') {
                return { deleted: false, reason: 'menu_button_missing' };
            }
            const sourceRowBeforeDelete = rowResult.row;
            const sourceRowCountBeforeDelete = queryNativeSourceRows().length || (sourceRowBeforeDelete ? 1 : 0);

            const existingMenuFingerprints = new Set(
                queryNativeMenuItems().map((item) => getNativeMenuItemFingerprint(item))
            );
            nativeMoreBtn.click();

            try {
                const menuItems = await waitForNativeMenuItems(existingMenuFingerprints);
                const deleteMenuItem = findNativeDeleteMenuItem(menuItems);
                if (!deleteMenuItem || typeof deleteMenuItem.click !== 'function') {
                    closeNativeOverlay();
                    return { deleted: false, reason: 'delete_menu_missing' };
                }

                const existingDialogs = new Set(queryNativeDialogs());
                deleteMenuItem.click();

                const confirmTarget = await waitForNativeDeleteConfirmTarget(existingDialogs, source);
                if (confirmTarget.candidateDialogs.length === 0) {
                    closeNativeOverlay();
                    return { deleted: false, reason: 'confirm_dialog_missing' };
                }
                if (confirmTarget.reason) {
                    closeNativeOverlay();
                    return { deleted: false, reason: confirmTarget.reason };
                }

                const confirmDialogs = confirmTarget.confirmDialogs;
                if (confirmDialogs.length === 0) {
                    closeNativeOverlay();
                    return { deleted: false, reason: 'confirm_dialog_unmatched' };
                }

                const confirmButton = confirmTarget.confirmButton;
                if (!confirmButton || typeof confirmButton.click !== 'function') {
                    closeNativeOverlay();
                    return { deleted: false, reason: 'confirm_button_missing' };
                }

                confirmButton.click();
                await waitForNativeDialogsToClose(confirmDialogs);
                const deleteConfirmed = await waitForNativeSourceRowRemoval(
                    sourceKey,
                    sourceRowBeforeDelete,
                    sourceRowCountBeforeDelete
                );
                if (!deleteConfirmed) {
                    return { deleted: false, reason: 'delete_not_confirmed' };
                }
                markNativeSourceDeleted(sourceKey);
                return { deleted: true };
            } catch (error) {
                console.error('NotebookLM Source Management: Error during native source deletion.', error);
                closeNativeOverlay();
                return { deleted: false, reason: 'native_delete_error' };
            }
        }

        function openNativeSourceDetails(sourceKey) {
            Promise.resolve(triggerNativeSourceDetailsDirectWithResult(sourceKey))
                .then((result) => {
                    if (result && result.ok) {
                        markSourceDetailViewRequested();
                    } else {
                        showNativeActionFailureToast('details', sourceKey, result?.reason || 'native_action_error', openNativeSourceDetails);
                    }
                })
                .catch((error) => {
                    console.error('NotebookLM Source Management: Source details open request failed.', error);
                    showNativeActionFailureToast('details', sourceKey, 'native_action_error', openNativeSourceDetails);
                });

            return true;
        }

        function renameNativeSourceFromAction(sourceKey) {
            Promise.resolve(triggerNativeSourceRenameWithResult(sourceKey))
                .then((result) => {
                    if (!result || !result.ok) {
                        showNativeActionFailureToast('rename', sourceKey, result?.reason || 'native_action_error', renameNativeSourceFromAction);
                    }
                })
                .catch((error) => {
                    console.error('NotebookLM Source Management: Source rename request failed.', error);
                    showNativeActionFailureToast('rename', sourceKey, 'native_action_error', renameNativeSourceFromAction);
                });

            return true;
        }

        function deleteNativeSourceFromAction(sourceKey) {
            Promise.resolve(deleteNativeSource(sourceKey))
                .then((result) => {
                    if (result && result.deleted) {
                        showToast(getMessage('ui_deleted_toast', ['1']), { variant: 'success' });
                        render();
                        return;
                    }
                    showNativeActionFailureToast('delete', sourceKey, result?.reason || 'native_delete_error', deleteNativeSourceFromAction);
                })
                .catch((error) => {
                    console.error('NotebookLM Source Management: Source delete request failed.', error);
                    showNativeActionFailureToast('delete', sourceKey, 'native_delete_error', deleteNativeSourceFromAction);
                });

            return true;
        }

        function resetSourceActionInvokers() {
            sourceActionInvokers = Object.create(null);
            sourceActionInvokers.openNativeDetails = (sourceKey) => openNativeSourceDetails(sourceKey);
            sourceActionInvokers.renameSource = (sourceKey) => renameNativeSourceFromAction(sourceKey);
            sourceActionInvokers.openTags = (sourceKey) => renderTagModal(sourceKey);
            sourceActionInvokers.moveToFolder = (sourceKey) => renderMoveToFolderModal(sourceKey);
            sourceActionInvokers.moveSourceToUngrouped = (sourceKey) => moveSourceToUngrouped(sourceKey);
            sourceActionInvokers.deleteSource = (sourceKey) => deleteNativeSourceFromAction(sourceKey);
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

            closeSourceActionMenu();
            const menuItem = getSourceActionMenuItems(sourceKey).find((item) => item.action === action);
            if (menuItem?.disabled) {
                showToast(getMessage('ui_keyboard_move_unavailable'), { variant: 'info' });
                return false;
            }

            switch (action) {
            case 'view-source-details': {
                const didOpen = sourceActionInvokers.openNativeDetails(sourceKey);
                if (didOpen === false) {
                    showNativeActionFailureToast('details', sourceKey, 'native_action_error', openNativeSourceDetails);
                    return false;
                }
                return true;
            }
            case 'rename-source':
                return sourceActionInvokers.renameSource(sourceKey);
            case 'tags':
                sourceActionInvokers.openTags(sourceKey);
                return true;
            case 'move':
                sourceActionInvokers.moveToFolder(sourceKey);
                return true;
            case 'move-ungrouped':
                return sourceActionInvokers.moveSourceToUngrouped(sourceKey);
            case 'delete-source':
                return sourceActionInvokers.deleteSource(sourceKey);
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
            queryNativeDialogs,
            isNativeDialogVisible,
            getNativeDialogMetadata,
            getNativeDialogFingerprint,
            isNativeDeleteConfirmDialog,
            findNativeDeleteConfirmDialogs,
            getNativeDeleteMenuItemScore,
            getNativeRenameMenuItemScore,
            scoreNativeMenuItemAction,
            findNativeActionMenuItem,
            findNativeDeleteMenuItem,
            findNativeRenameMenuItem,
            findNativeDeleteConfirmButton,
            getNativeSourceDetailsMenuItemScore,
            findNativeSourceDetailsMenuItem,
            resolveFreshSourceRow,
            createSyntheticActivationEvent,
            dispatchSyntheticActivation,
            isSourceDetailsTargetCandidate,
            collectSourceDetailsCandidates,
            getSourceDetailsTargetScore,
            triggerNativeSourceDetailsDirectWithResult,
            triggerNativeSourceDetailsDirect,
            waitForNativeMenuItems,
            waitForNativeDialogs,
            waitForNativeDialogsToClose,
            waitForNativeDeleteConfirmTarget,
            triggerNativeSourceDetailsViaNativeMenuWithResult,
            triggerNativeSourceDetailsViaNativeMenu,
            triggerNativeSourceRenameWithResult,
            triggerNativeSourceRename,
            deleteNativeSource,
            getNativeActionFailureMessage,
            showNativeActionFailureToast,
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
