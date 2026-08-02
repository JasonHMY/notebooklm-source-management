(function () {
    'use strict';

    /**
     * createContentSourceActions(deps) — 源行右键 action 菜单的渲染 + 行为分发主控。
     * 自菜单定位 (含视口边界 + 子菜单)、跨语言 NotebookLM 原生菜单/对话框匹配 (rename/delete/details)、
     * 到 dispatch 合成激活事件触发原生流程,再到失败回退提示与 invoker 注册表,全部在这里。
     * 通过内部 import content-source-action-menu 拿到 item 列表纯函数,自己负责 DOM + lifecycle。
     *
     * @param {Object} deps 30+ 项依赖,大致四类(完整 destructuring 见 line 4+):
     *   - 环境/state: runtime, getDocument / getWindow / getState / getSourcesByKey /
     *     getShadowRoot / getDEPS, findElement
     *   - i18n / 日志 / 渲染: getMessage, showToast, developerLog, render
     *   - 过滤 / 桥接: sourceMatchesCurrentFilters, resolveFreshRowEntry,
     *     extractSourceIdentitySnapshot, getSourceElements
     *   - native action 协调: renderTagModal, renderMoveToFolderModal,
     *     canMoveSourceToUngrouped, moveSourceToUngrouped,
     *     markSourceDetailViewRequested, onNativeSourceRenameStarted,
     *     onNativeSourceDeleteAccepted, recordNativeActionFailure
     *   - 子组件工厂: createContentSourceActionMenu (默认从 global 取)
     * @returns {Object} 50+ helpers。主要入口 `handleSourceActionSelection`、
     *   `toggleSourceActionMenu`、`closeSourceActionMenu`、`syncActiveSourceActionMenuState`;
     *   一组原生菜单/对话框探测 (findNative*MenuItem / queryNativeMenuItems /
     *   waitForNative*),原生流程触发 (triggerNativeSource*),
     *   定位 helpers (getSourceActionMenuPosition / getSourceActionSubmenuPosition),
     *   以及 active 状态访问器 (get/setActiveSourceActionSourceKey 等)。
     *   完整 return 块见 line 1755。
     */
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
        const developerLog = typeof deps.developerLog === 'function'
            ? deps.developerLog
            : () => false;
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
        const resolveDirectionalTarget = typeof deps.resolveDirectionalTarget === 'function'
            ? deps.resolveDirectionalTarget
            : () => ({ ok: false, reason: 'unavailable', target: null });
        const moveSourceToUngrouped = typeof deps.moveSourceToUngrouped === 'function'
            ? deps.moveSourceToUngrouped
            : () => false;
        const orderTreeItem = typeof deps.orderTreeItem === 'function'
            ? deps.orderTreeItem
            : () => false;
        const markSourceDetailViewRequested = typeof deps.markSourceDetailViewRequested === 'function'
            ? deps.markSourceDetailViewRequested
            : () => {};
        const onNativeSourceRenameStarted = typeof deps.onNativeSourceRenameStarted === 'function'
            ? deps.onNativeSourceRenameStarted
            : () => {};
        const onNativeSourceDeleteAccepted = typeof deps.onNativeSourceDeleteAccepted === 'function'
            ? deps.onNativeSourceDeleteAccepted
            : () => {};
        const recordNativeActionFailure = typeof deps.recordNativeActionFailure === 'function'
            ? deps.recordNativeActionFailure
            : () => {};
        const getNativeActionContext = typeof deps.getNativeActionContext === 'function'
            ? deps.getNativeActionContext
            : () => ({ projectId: '', managerInstanceToken: 0 });
        const getNativeActionHostElement = typeof deps.getNativeActionHostElement === 'function'
            ? deps.getNativeActionHostElement
            : () => getDocument()?.body || null;
        const getNativeSourceInventory = typeof deps.getNativeSourceInventory === 'function'
            ? deps.getNativeSourceInventory
            : null;
        const createContentNativeActionCoordinator = typeof deps.createContentNativeActionCoordinator === 'function'
            ? deps.createContentNativeActionCoordinator
            : globalThis.NSM_CREATE_CONTENT_NATIVE_ACTION_COORDINATOR;
        const nativeActionCoordinator = deps.nativeActionCoordinator
            || (
                typeof createContentNativeActionCoordinator === 'function'
                    ? createContentNativeActionCoordinator({
                        getDocument,
                        getContext: getNativeActionContext,
                        getHostElement: getNativeActionHostElement,
                        developerLog
                    })
                    : null
            );
        const createContentSourceActionMenu = typeof deps.createContentSourceActionMenu === 'function'
            ? deps.createContentSourceActionMenu
            : globalThis.NSM_CREATE_CONTENT_SOURCE_ACTION_MENU;
        const sourceActionMenu = typeof createContentSourceActionMenu === 'function'
            ? createContentSourceActionMenu({
                getState,
                getSourcesByKey,
                getMessage,
                canMoveSourceToUngrouped,
                resolveDirectionalTarget
            })
            : {};
        const menuCanOpenSourceActionMenu = typeof sourceActionMenu.canOpenSourceActionMenu === 'function'
            ? sourceActionMenu.canOpenSourceActionMenu
            : null;
        const menuCreateNativeActionResult = typeof sourceActionMenu.createNativeActionResult === 'function'
            ? sourceActionMenu.createNativeActionResult
            : null;
        const menuGetSourceActionMenuItems = typeof sourceActionMenu.getSourceActionMenuItems === 'function'
            ? sourceActionMenu.getSourceActionMenuItems
            : null;
        const menuGetSourceActionSubmenuItems = typeof sourceActionMenu.getSourceActionSubmenuItems === 'function'
            ? sourceActionMenu.getSourceActionSubmenuItems
            : null;
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
            'dialog',
            'mat-dialog-container',
            'mat-mdc-dialog-container',
            '.mat-dialog-container',
            '[role="dialog"]',
            '[role="alertdialog"]',
            '[aria-modal="true"]',
            '.mat-mdc-dialog-container',
            '.mat-mdc-dialog-surface',
            '.mdc-dialog',
            '.mdc-dialog__surface',
            '.cdk-dialog-container',
            '.cdk-overlay-pane'
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
            confirm_button_ambiguous: 'ui_native_action_confirm_button_missing',
            native_action_busy: 'ui_native_action_failed',
            native_action_invalid: 'ui_native_action_failed',
            native_action_stale: 'ui_native_action_failed',
            native_action_context_changed: 'ui_native_action_failed',
            native_action_source_changed: 'ui_native_action_source_unavailable',
            details_menu_ambiguous: 'ui_native_action_menu_item_missing',
            rename_menu_ambiguous: 'ui_native_action_menu_item_missing',
            delete_menu_ambiguous: 'ui_native_action_menu_item_missing',
            rename_watch_failed: 'ui_native_action_failed',
            delete_not_confirmed: 'ui_native_action_failed',
            native_delete_inventory_unverified: 'ui_native_action_failed',
            native_delete_target_missing: 'ui_native_action_source_unavailable',
            native_delete_target_ambiguous: 'ui_native_action_failed',
            source_row_mismatch: 'ui_native_action_source_unavailable',
            native_action_error: 'ui_native_action_failed',
            native_delete_error: 'ui_native_action_failed'
        };

        function canOpenSourceActionMenu(source) {
            if (menuCanOpenSourceActionMenu) return menuCanOpenSourceActionMenu(source);
            return Boolean(source && !source.isDisabled && !source.isLoading);
        }

        function createNativeActionResult(ok, reason = '') {
            return menuCreateNativeActionResult
                ? menuCreateNativeActionResult(ok, reason)
                : (ok ? { ok: true } : { ok: false, reason: reason || 'native_action_error' });
        }

        function getSourceOperationIdentity(source) {
            return {
                stableToken: String(source?.stableToken || ''),
                fingerprint: String(source?.fingerprint || ''),
                normalizedTitle: getSourceComparableTitle(source)
            };
        }

        function acquireNativeActionOperation(action, sourceKey, source, options = {}) {
            if (!nativeActionCoordinator) {
                return { ok: true, operation: null, owned: false, stepOwned: false };
            }
            if (options.operation) {
                const validation = nativeActionCoordinator.validateOperation(options.operation);
                if (!validation.ok) {
                    return {
                        ok: false,
                        reason: validation.reason,
                        operation: null,
                        owned: false,
                        stepOwned: false
                    };
                }
                const stepResult = nativeActionCoordinator.bindOperationStep?.(
                    options.operation,
                    {
                        action,
                        sourceKey,
                        sourceIdentity: getSourceOperationIdentity(source)
                    }
                );
                return stepResult?.ok
                    ? {
                        ok: true,
                        operation: options.operation,
                        owned: false,
                        stepOwned: true,
                        step: stepResult.step
                    }
                    : {
                        ok: false,
                        reason: stepResult?.reason || 'native_action_busy',
                        operation: null,
                        owned: false,
                        stepOwned: false
                    };
            }
            const beginResult = nativeActionCoordinator.beginOperation({
                action,
                sourceKey,
                sourceIdentity: getSourceOperationIdentity(source)
            });
            return beginResult.ok
                ? {
                    ok: true,
                    operation: beginResult.operation,
                    owned: true,
                    stepOwned: false
                }
                : {
                    ok: false,
                    reason: beginResult.reason,
                    operation: null,
                    owned: false,
                    stepOwned: false
                };
        }

        function validateNativeActionOperation(acquired, action, sourceKey, options = {}) {
            if (!nativeActionCoordinator || !acquired?.operation) {
                return { ok: true, reason: '' };
            }
            const expected = {
                action,
                sourceKey,
                ...(
                    options.allowIdentityChange
                        ? {}
                        : {
                            sourceIdentity: getSourceOperationIdentity(
                                getSourcesByKey().get(sourceKey)
                            )
                        }
                )
            };
            if (acquired.stepOwned) {
                return nativeActionCoordinator.validateOperationStep(
                    acquired.operation,
                    expected
                );
            }
            return nativeActionCoordinator.validateOperation(
                acquired.operation,
                acquired.owned ? expected : {}
            );
        }

        function releaseNativeActionOperation(acquired, reason = 'completed') {
            if (!nativeActionCoordinator || !acquired?.operation) return false;
            if (acquired.stepOwned) {
                return nativeActionCoordinator.clearOperationStep?.(
                    acquired.operation,
                    acquired.step
                ) || false;
            }
            if (!acquired.owned) return false;
            return nativeActionCoordinator.endOperation(acquired.operation, reason);
        }

        function beginNativeActionSession(meta = {}) {
            if (!nativeActionCoordinator) {
                return { ok: true, operation: null };
            }
            return nativeActionCoordinator.beginOperation({
                action: meta.action || 'batch-delete',
                sourceKey: meta.sourceKey || 'batch',
                sourceIdentity: meta.sourceIdentity || {}
            });
        }

        function endNativeActionSession(operation, reason = 'completed') {
            if (!nativeActionCoordinator || !operation) return false;
            return nativeActionCoordinator.endOperation(operation, reason);
        }

        function cancelActiveNativeAction(reason = 'native_action_cancelled') {
            if (!nativeActionCoordinator) return false;
            return nativeActionCoordinator.cancelActiveOperation(reason);
        }

        function markNativeSourceDeleted(sourceKey) {
            if (!sourceKey) return;
            if (!(runtime.recentNativeDeletedSourceKeys instanceof Set)) {
                runtime.recentNativeDeletedSourceKeys = new Set();
            }
            if (!(runtime.recentNativeDeletedSourceIdentityKeys instanceof Set)) {
                runtime.recentNativeDeletedSourceIdentityKeys = new Set();
            }
            const source = getSourcesByKey().get(sourceKey) || null;
            runtime.recentNativeDeletedSourceKeys.add(sourceKey);
            if (source?.key) {
                runtime.recentNativeDeletedSourceKeys.add(source.key);
            }
            if (source?.stableToken) {
                runtime.recentNativeDeletedSourceIdentityKeys.add(`stable:${source.stableToken}`);
            }
            if (source?.fingerprint) {
                runtime.recentNativeDeletedSourceIdentityKeys.add(`fingerprint:${source.fingerprint}`);
            }
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
            developerLog('warn', 'native_action', `${action}_failed`, {
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
            return menuGetSourceActionMenuItems ? menuGetSourceActionMenuItems(sourceKey) : [];
        }

        function getSourceActionSubmenuItems(sourceKey, submenuAction) {
            return menuGetSourceActionSubmenuItems
                ? menuGetSourceActionSubmenuItems(sourceKey, submenuAction)
                : [];
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

            const dialogs = [];
            const selector = NATIVE_DIALOG_SELECTORS.join(', ');
            Array.from(doc.querySelectorAll(selector)).forEach((dialog) => {
                appendNativeDialogCandidate(dialogs, dialog);
            });
            return dialogs;
        }

        function nativeElementContains(container, element) {
            if (!container || !element || container === element || typeof container.contains !== 'function') {
                return false;
            }
            try {
                return Boolean(container.contains(element));
            } catch (error) {
                return false;
            }
        }

        function appendNativeDialogCandidate(dialogs, dialog) {
            if (!dialog || !isNativeDialogVisible(dialog)) return;

            for (let index = dialogs.length - 1; index >= 0; index--) {
                const existing = dialogs[index];
                if (existing === dialog) return;
                if (nativeElementContains(dialog, existing)) return;
                if (nativeElementContains(existing, dialog)) {
                    dialogs.splice(index, 1);
                }
            }

            dialogs.push(dialog);
        }

        function queryNativeDialogButtons(dialog) {
            if (!dialog || typeof dialog.querySelectorAll !== 'function') return [];

            const buttons = [];
            const appendButton = (button) => {
                if (!button || buttons.includes(button)) return;
                buttons.push(button);
            };

            ['button', '[role="button"]'].forEach((selector) => {
                try {
                    Array.from(dialog.querySelectorAll(selector)).forEach(appendButton);
                } catch (error) {
                    // Ignore unsupported selector variants in test or older DOM contexts.
                }
            });

            return buttons;
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
            const buttons = queryNativeDialogButtons(dialog);
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

        function createNativeDialogSnapshot(dialogs = []) {
            const dialogList = Array.isArray(dialogs) ? dialogs : Array.from(dialogs || []);
            const snapshot = new Map();
            dialogList.forEach((dialog) => {
                if (dialog) {
                    snapshot.set(dialog, getNativeDialogFingerprint(dialog));
                }
            });
            return snapshot;
        }

        function normalizeNativeDialogSnapshot(dialogsOrSnapshot = []) {
            if (dialogsOrSnapshot instanceof Map) {
                return dialogsOrSnapshot;
            }
            return createNativeDialogSnapshot(dialogsOrSnapshot);
        }

        function isNativeDialogNewOrChanged(dialog, existingDialogSnapshot) {
            if (!dialog || !(existingDialogSnapshot instanceof Map)) return Boolean(dialog);
            if (!existingDialogSnapshot.has(dialog)) return true;
            return existingDialogSnapshot.get(dialog) !== getNativeDialogFingerprint(dialog);
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

        function resolveNativeActionMenuItem(menuItems = [], action, options = {}) {
            const items = Array.isArray(menuItems) ? menuItems : Array.from(menuItems || []);
            const minimumScore = Number.isFinite(options.minimumScore) ? options.minimumScore : 0;
            let bestCandidate = null;
            let bestScore = Number.NEGATIVE_INFINITY;
            let bestCandidateCount = 0;

            items.forEach((item) => {
                const score = scoreNativeMenuItemAction(action, item);
                if (score > bestScore) {
                    bestScore = score;
                    bestCandidate = item;
                    bestCandidateCount = 1;
                } else if (score === bestScore && score > Number.NEGATIVE_INFINITY) {
                    bestCandidateCount += 1;
                }
            });

            if (bestCandidateCount > 1 && bestScore > minimumScore) {
                return {
                    item: null,
                    reason: 'native_menu_ambiguous',
                    score: bestScore
                };
            }
            if (bestCandidate && bestScore > minimumScore) {
                return { item: bestCandidate, reason: '', score: bestScore };
            }

            if (options.allowSingleSafeFallback && items.length === 1 && items[0]) {
                const fallbackScore = scoreNativeMenuItemAction(action, items[0]);
                if (fallbackScore > Number.NEGATIVE_INFINITY) {
                    return { item: items[0], reason: '', score: fallbackScore };
                }
            }

            return {
                item: null,
                reason: 'native_menu_item_missing',
                score: bestScore
            };
        }

        function findNativeActionMenuItem(menuItems = [], action, options = {}) {
            return resolveNativeActionMenuItem(menuItems, action, options).item;
        }

        function findNativeDeleteMenuItem(menuItems = []) {
            return findNativeActionMenuItem(menuItems, 'delete');
        }

        function findNativeRenameMenuItem(menuItems = []) {
            return findNativeActionMenuItem(menuItems, 'rename');
        }

        function getNativeDeleteConfirmButtonScore(button) {
            if (!button) return Number.NEGATIVE_INFINITY;
            const text = String(button?.textContent || '').toLowerCase();
            const ariaLabel = String(button?.getAttribute?.('aria-label') || '').toLowerCase();
            if (NATIVE_CANCEL_TEXT_PATTERN.test(text) || NATIVE_CANCEL_TEXT_PATTERN.test(ariaLabel)) {
                return Number.NEGATIVE_INFINITY;
            }

            const className = String(button?.className || '').toLowerCase();
            const iconText = String(button?.querySelector?.('mat-icon, .google-symbols')?.textContent || '')
                .trim()
                .toLowerCase();
            const hasConfirmText = NATIVE_CONFIRM_TEXT_PATTERN.test(text)
                || NATIVE_CONFIRM_TEXT_PATTERN.test(ariaLabel);
            if (hasConfirmText && (className.includes('warn') || className.includes('primary'))) return 100;
            if (hasConfirmText) return 90;
            if (className.includes('warn')) return 80;
            if (className.includes('primary')) return 70;
            if (iconText === 'check') return 60;
            return Number.NEGATIVE_INFINITY;
        }

        function resolveNativeDeleteConfirmButton(dialogs = []) {
            const dialogList = findNativeDeleteConfirmDialogs(dialogs);
            const candidates = [];

            dialogList.forEach((dialog) => {
                const buttons = queryNativeDialogButtons(dialog);
                buttons.forEach((button) => {
                    const score = getNativeDeleteConfirmButtonScore(button);
                    if (score > Number.NEGATIVE_INFINITY) {
                        candidates.push({ button, score });
                    }
                });
            });

            if (candidates.length === 0) {
                return { button: null, reason: 'confirm_button_missing' };
            }
            candidates.sort((left, right) => right.score - left.score);
            if (candidates.length > 1 && candidates[0].score === candidates[1].score) {
                return { button: null, reason: 'confirm_button_ambiguous' };
            }
            return { button: candidates[0].button, reason: '' };
        }

        function findNativeDeleteConfirmButton(dialogs = []) {
            return resolveNativeDeleteConfirmButton(dialogs).button;
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

        async function waitForNativeDialogsToClose(
            dialogs = [],
            maxAttempts = 8,
            delayMs = 100,
            options = {}
        ) {
            const dialogList = Array.isArray(dialogs) ? dialogs : Array.from(dialogs || []);
            if (dialogList.length === 0) return true;
            const dialogSnapshot = createNativeDialogSnapshot(dialogList);

            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                const operationState = typeof options.validateOperation === 'function'
                    ? options.validateOperation()
                    : null;
                if (operationState && !operationState.ok) return false;
                const openDialogs = queryNativeDialogs();
                const hasOpenDialog = openDialogs.some((dialog) => dialogSnapshot.has(dialog));
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

        function isNativeSourceWordCharacter(value) {
            return Boolean(value && /[\p{L}\p{N}]/u.test(value));
        }

        function containsBoundarySafeSourceTitle(dialogText, sourceTitle) {
            const haystack = normalizeNativeSourceText(dialogText);
            const needle = normalizeNativeSourceText(sourceTitle);
            if (!haystack || !needle) return false;

            let offset = 0;
            while (offset <= haystack.length - needle.length) {
                const index = haystack.indexOf(needle, offset);
                if (index < 0) return false;
                const before = index > 0 ? haystack[index - 1] : '';
                const afterIndex = index + needle.length;
                const after = afterIndex < haystack.length ? haystack[afterIndex] : '';
                if (!isNativeSourceWordCharacter(before) && !isNativeSourceWordCharacter(after)) {
                    return true;
                }
                offset = index + Math.max(1, needle.length);
            }
            return false;
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

            const targetMatches = containsBoundarySafeSourceTitle(dialogText, targetTitle);
            let duplicateTargetTitleCount = 0;
            const otherTitleMatches = [];
            for (const otherSource of getSourcesByKey().values()) {
                if (!otherSource || otherSource.key === source?.key) continue;
                const otherTitle = getSourceComparableTitle(otherSource);
                if (!otherTitle) continue;
                if (otherTitle === targetTitle) {
                    duplicateTargetTitleCount += 1;
                }
                if (
                    otherTitle.length >= 3
                    && containsBoundarySafeSourceTitle(dialogText, otherTitle)
                ) {
                    otherTitleMatches.push(otherTitle);
                }
            }

            if (targetMatches && duplicateTargetTitleCount > 0) return 'ambiguous';
            if (targetMatches && otherTitleMatches.length > 0) {
                const conflictingMatches = otherTitleMatches.filter((title) => (
                    !targetTitle.includes(title)
                ));
                if (conflictingMatches.length === 0) return 'match';
                return conflictingMatches.some((title) => title.includes(targetTitle))
                    ? 'mismatch'
                    : 'ambiguous';
            }
            if (targetMatches) return 'match';
            if (otherTitleMatches.length > 0) return 'mismatch';
            return 'unknown';
        }

        function filterNativeDeleteConfirmDialogsForSource(dialogs, source) {
            const confirmDialogs = findNativeDeleteConfirmDialogs(dialogs);
            const matchingDialogs = [];
            const unknownDialogs = [];
            const mismatchedDialogs = [];
            const ambiguousDialogs = [];

            confirmDialogs.forEach((dialog) => {
                const matchState = getDialogSourceTitleMatchState(dialog, source);
                if (matchState === 'match') {
                    matchingDialogs.push(dialog);
                } else if (matchState === 'ambiguous') {
                    ambiguousDialogs.push(dialog);
                } else if (matchState === 'mismatch') {
                    mismatchedDialogs.push(dialog);
                } else {
                    unknownDialogs.push(dialog);
                }
            });

            if (ambiguousDialogs.length > 0) {
                return { dialogs: [], reason: 'confirm_dialog_ambiguous' };
            }
            if (
                matchingDialogs.length === 1
                && unknownDialogs.length === 0
                && mismatchedDialogs.length === 0
            ) {
                return { dialogs: matchingDialogs, reason: '' };
            }
            if (
                matchingDialogs.length > 1
                || (
                    matchingDialogs.length === 1
                    && (unknownDialogs.length > 0 || mismatchedDialogs.length > 0)
                )
            ) {
                return { dialogs: [], reason: 'confirm_dialog_ambiguous' };
            }
            if (mismatchedDialogs.length > 0 && unknownDialogs.length === 0) {
                return { dialogs: [], reason: 'confirm_dialog_mismatched_source' };
            }
            if (unknownDialogs.length > 1 || mismatchedDialogs.length > 1) {
                return { dialogs: [], reason: 'confirm_dialog_ambiguous' };
            }
            if (unknownDialogs.length === 1 && mismatchedDialogs.length === 0) {
                return { dialogs: [], reason: 'confirm_dialog_unmatched' };
            }
            if (mismatchedDialogs.length === 1) {
                return { dialogs: [], reason: 'confirm_dialog_mismatched_source' };
            }

            return { dialogs: [], reason: '' };
        }

        async function waitForNativeDeleteConfirmTarget(
            existingDialogs = new Set(),
            source = null,
            maxAttempts = 10,
            delayMs = 100,
            options = {}
        ) {
            const existingDialogSnapshot = normalizeNativeDialogSnapshot(existingDialogs);
            let visibleDialogs = [];
            let candidateDialogs = [];
            let confirmDialogs = [];
            let reason = '';

            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                const operationState = typeof options.validateOperation === 'function'
                    ? options.validateOperation()
                    : null;
                if (operationState && !operationState.ok) {
                    return {
                        visibleDialogs,
                        candidateDialogs,
                        confirmDialogs,
                        confirmButton: null,
                        reason: operationState.reason
                    };
                }
                visibleDialogs = queryNativeDialogs();
                candidateDialogs = visibleDialogs.filter((dialog) => (
                    isNativeDialogNewOrChanged(dialog, existingDialogSnapshot)
                ));
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
                const confirmButtonResult = resolveNativeDeleteConfirmButton(confirmDialogs);
                if (confirmButtonResult.reason === 'confirm_button_ambiguous') {
                    return {
                        visibleDialogs,
                        candidateDialogs,
                        confirmDialogs,
                        confirmButton: null,
                        reason: confirmButtonResult.reason
                    };
                }
                if (confirmButtonResult.button) {
                    return {
                        visibleDialogs,
                        candidateDialogs,
                        confirmDialogs,
                        confirmButton: confirmButtonResult.button,
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

        function closeNativeOverlay(operation = null) {
            if (
                operation
                && nativeActionCoordinator
                && !nativeActionCoordinator.validateOperation(operation).ok
            ) {
                return false;
            }
            const doc = getDocument();
            doc?.body?.click?.();
            return true;
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

        function findNativeSourcePanel() {
            const doc = getDocument();
            const panelSelectors = Array.isArray(getDEPS().panel)
                ? getDEPS().panel
                : [getDEPS().panel];
            return findElement(
                panelSelectors.filter((selector) => typeof selector === 'string' && selector.trim()),
                doc
            );
        }

        function isElementWithinNativeSourcePanel(element, panel) {
            if (!element || !panel) return false;
            if (element === panel) return true;
            if (typeof panel.contains === 'function') {
                try {
                    return Boolean(panel.contains(element));
                } catch (error) {
                    // Fall back to parent traversal for framework-owned or mocked nodes.
                }
            }

            let cursor = element.parentElement || element.parentNode || null;
            let depth = 0;
            while (cursor && depth < 32) {
                if (cursor === panel) return true;
                cursor = cursor.parentElement || cursor.parentNode || null;
                depth += 1;
            }
            return false;
        }

        function parseNativeSourceCountHint(value) {
            const parsed = Number.parseInt(String(value ?? ''), 10);
            return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
        }

        function getNativeSourceTotalHint(panel, rows = []) {
            const panelHints = [
                panel?.getAttribute?.('aria-rowcount'),
                panel?.getAttribute?.('data-total-count'),
                panel?.getAttribute?.('data-source-count')
            ];
            for (const value of panelHints) {
                const parsed = parseNativeSourceCountHint(value);
                if (parsed != null) return parsed;
            }

            let rowHint = null;
            rows.forEach((row) => {
                const setSize = parseNativeSourceCountHint(row?.getAttribute?.('aria-setsize'));
                if (setSize != null && (rowHint == null || setSize > rowHint)) {
                    rowHint = setSize;
                }
            });
            return rowHint;
        }

        function getNativeIdentityKey(identity) {
            if (!identity) return '';
            if (identity.stableToken) return `stable:${identity.stableToken}`;
            if (identity.fingerprint) return `fingerprint:${identity.fingerprint}`;
            const normalizedTitle = normalizeNativeSourceText(
                identity.normalizedTitle || identity.title || identity.ariaLabel || ''
            );
            return normalizedTitle ? `title:${normalizedTitle}` : '';
        }

        function getSourceDeleteIdentityKeys(source) {
            const stableToken = String(source?.stableToken || '').trim();
            if (stableToken) return [`stable:${stableToken}`];
            const fingerprint = String(source?.fingerprint || '').trim();
            if (fingerprint) return [`fingerprint:${fingerprint}`];
            const normalizedTitle = getSourceComparableTitle(source);
            return normalizedTitle ? [`title:${normalizedTitle}`] : [];
        }

        function getAuthoritativeInventoryTotal(inventory) {
            const totalHint = parseNativeSourceCountHint(inventory?.totalHint);
            const identityKeys = Array.isArray(inventory?.identityKeys)
                ? inventory.identityKeys.filter(Boolean)
                : [];
            if (
                !inventory?.complete
                || totalHint == null
                || identityKeys.length !== totalHint
            ) {
                return null;
            }
            return totalHint;
        }

        function inventoryContainsSourceIdentity(inventory, source) {
            const expectedKeys = getSourceDeleteIdentityKeys(source);
            if (expectedKeys.length === 0 || !Array.isArray(inventory?.identityKeys)) {
                return false;
            }
            const observedKeys = new Set(inventory.identityKeys);
            return expectedKeys.some((identityKey) => observedKeys.has(identityKey));
        }

        function getInventorySourceIdentityMatchCount(inventory, source) {
            const expectedKeys = new Set(getSourceDeleteIdentityKeys(source));
            if (expectedKeys.size === 0 || !Array.isArray(inventory?.identityKeys)) {
                return 0;
            }
            return inventory.identityKeys.reduce((count, identityKey) => (
                expectedKeys.has(identityKey) ? count + 1 : count
            ), 0);
        }

        function getNativeDeleteInventoryPreflight(inventory, source) {
            const totalHint = getAuthoritativeInventoryTotal(inventory);
            if (totalHint == null) {
                return {
                    ok: false,
                    reason: 'native_delete_inventory_unverified',
                    totalHint: null,
                    inventory
                };
            }
            const targetIdentityCount = getInventorySourceIdentityMatchCount(inventory, source);
            if (targetIdentityCount === 0) {
                return {
                    ok: false,
                    reason: 'native_delete_target_missing',
                    totalHint,
                    inventory
                };
            }
            if (targetIdentityCount !== 1) {
                return {
                    ok: false,
                    reason: 'native_delete_target_ambiguous',
                    totalHint,
                    inventory
                };
            }
            return {
                ok: true,
                reason: '',
                totalHint,
                inventory
            };
        }

        function normalizeExternalNativeInventory(value) {
            if (!value || typeof value !== 'object') return null;
            const completeness = String(value.completeness || '').toLowerCase();
            const allowedCompleteness = new Set(['complete', 'partial', 'virtualized', 'loading']);
            if (!allowedCompleteness.has(completeness)) return null;
            const rawIdentityKeys = value.observedIdentityKeys
                || value.identityKeys
                || value.observedIdentities
                || [];
            const identityKeys = Array.from(rawIdentityKeys || [])
                .map((entry) => (
                    typeof entry === 'string' ? entry : getNativeIdentityKey(entry)
                ))
                .filter(Boolean)
                .sort();
            const totalHint = parseNativeSourceCountHint(value.totalHint ?? value.totalCount);
            return {
                completeness,
                complete: completeness === 'complete',
                reason: completeness === 'complete'
                    ? ''
                    : String(value.reason || `source_panel_${completeness}`),
                rowCount: Number.isFinite(Number(value.rowCount))
                    ? Number(value.rowCount)
                    : identityKeys.length,
                totalHint,
                identityKeys,
                identitySignature: identityKeys.join('|'),
                hasAuthoritativeTotal: completeness === 'complete'
                    && totalHint != null
                    && identityKeys.length === totalHint
            };
        }

        function getNativeSourcePanelVerificationState(panel, rows) {
            if (!panel || !isElementInDocument(panel)) {
                return { complete: false, reason: 'source_panel_missing' };
            }
            if (
                panel.hidden === true
                || String(panel.getAttribute?.('aria-hidden') || '').toLowerCase() === 'true'
                || String(panel.getAttribute?.('aria-busy') || '').toLowerCase() === 'true'
            ) {
                return { complete: false, reason: 'source_panel_incomplete' };
            }

            const panelStateText = [
                panel.getAttribute?.('data-state'),
                panel.getAttribute?.('data-status')
            ].filter(Boolean).join(' ').toLowerCase();
            if (/\b(?:busy|loading|pending|processing)\b/.test(panelStateText)) {
                return { complete: false, reason: 'source_panel_incomplete' };
            }

            try {
                if (panel.querySelector?.('[aria-busy="true"], [role="progressbar"], mat-spinner, mat-progress-spinner')) {
                    return { complete: false, reason: 'source_panel_incomplete' };
                }
                if (panel.querySelector?.('[data-virtualized="true"], [data-virtual-scroll="true"]')) {
                    return {
                        complete: false,
                        completeness: 'virtualized',
                        reason: 'source_panel_virtualized'
                    };
                }
            } catch (error) {
                return { complete: false, reason: 'source_panel_incomplete' };
            }

            const totalHint = getNativeSourceTotalHint(panel, rows);
            if (totalHint != null && totalHint > rows.length) {
                return {
                    complete: false,
                    completeness: 'virtualized',
                    reason: 'source_panel_virtualized',
                    totalHint
                };
            }

            for (const row of rows) {
                const identity = getNativeRowIdentity(row);
                if (
                    !identity
                    || identity.hasProcessingSignal
                    || !hasComparableSourceIdentity(identity)
                ) {
                    return { complete: false, reason: 'source_panel_incomplete' };
                }
            }

            return {
                complete: true,
                completeness: 'complete',
                reason: '',
                totalHint
            };
        }

        function getNativeSourceInventorySnapshot() {
            if (getNativeSourceInventory) {
                try {
                    const externalInventory = normalizeExternalNativeInventory(
                        getNativeSourceInventory()
                    );
                    if (externalInventory) return externalInventory;
                } catch (error) {
                    return {
                        complete: false,
                        completeness: 'partial',
                        reason: 'source_panel_incomplete',
                        rowCount: 0,
                        totalHint: null,
                        identityKeys: [],
                        identitySignature: '',
                        hasAuthoritativeTotal: false
                    };
                }
            }

            const panel = findNativeSourcePanel();
            const rows = queryNativeSourceRows();
            const panelState = getNativeSourcePanelVerificationState(panel, rows);
            const identityKeys = rows
                .map((row) => getNativeIdentityKey(getNativeRowIdentity(row)))
                .filter(Boolean)
                .sort();
            return {
                complete: Boolean(panelState.complete),
                completeness: panelState.completeness || (panelState.complete ? 'complete' : 'partial'),
                reason: panelState.reason || '',
                rowCount: rows.length,
                totalHint: panelState.totalHint ?? getNativeSourceTotalHint(panel, rows),
                identityKeys,
                identitySignature: identityKeys.join('|'),
                hasAuthoritativeTotal: Boolean(panelState.complete)
                    && panelState.totalHint != null
                    && identityKeys.length === panelState.totalHint,
                panel,
                rows
            };
        }

        function doesInventoryContainAllSurvivors(beforeInventory, afterInventory, source) {
            if (!beforeInventory?.identityKeys?.length || !afterInventory?.identityKeys) return true;
            const targetIdentityKeys = new Set(getSourceDeleteIdentityKeys(source));
            const remainingCounts = new Map();
            afterInventory.identityKeys.forEach((identityKey) => {
                remainingCounts.set(identityKey, (remainingCounts.get(identityKey) || 0) + 1);
            });
            let removedTarget = false;
            for (const identityKey of beforeInventory.identityKeys) {
                if (!removedTarget && targetIdentityKeys.has(identityKey)) {
                    removedTarget = true;
                    continue;
                }
                const available = remainingCounts.get(identityKey) || 0;
                if (available < 1) return false;
                remainingCounts.set(identityKey, available - 1);
            }
            return true;
        }

        function getNativeDeleteAbsenceEvidence(
            sourceKey,
            source,
            originalRow,
            originalInventory = null
        ) {
            const inventory = getNativeSourceInventorySnapshot();
            if (!inventory.complete) {
                return { confirmed: false, reason: inventory.reason };
            }
            const originalInventoryPreflight = getNativeDeleteInventoryPreflight(
                originalInventory,
                source
            );
            const afterTotal = getAuthoritativeInventoryTotal(inventory);
            if (
                !originalInventoryPreflight.ok
                || afterTotal == null
            ) {
                // A current DOM row count can shrink because a virtual window unmounted or
                // backfilled. Only a complete identity inventory with an explicit native
                // total is authoritative enough to commit the local deletion.
                return {
                    confirmed: false,
                    reason: originalInventoryPreflight.ok
                        ? 'native_delete_inventory_unverified'
                        : originalInventoryPreflight.reason
                };
            }
            const beforeTotal = originalInventoryPreflight.totalHint;
            const panel = inventory.panel || findNativeSourcePanel();
            const sourceRows = inventory.rows || queryNativeSourceRows();

            const freshEntry = resolveFreshRowEntry(sourceKey);
            if (
                freshEntry?.row
                && isElementWithinNativeSourcePanel(freshEntry.row, panel)
                && doesNativeRowMatchSource(source, freshEntry.row, freshEntry.identity)
            ) {
                return { confirmed: false, reason: 'source_still_present' };
            }
            if (sourceRows.some((row) => doesNativeRowMatchSource(source, row))) {
                return { confirmed: false, reason: 'source_still_present' };
            }
            if (
                originalRow
                && isElementWithinNativeSourcePanel(originalRow, panel)
                && doesNativeRowMatchSource(source, originalRow)
            ) {
                return { confirmed: false, reason: 'source_still_present' };
            }

            if (inventoryContainsSourceIdentity(inventory, source)) {
                return { confirmed: false, reason: 'source_still_present' };
            }

            const expectedTotal = Math.max(0, beforeTotal - 1);
            if (beforeTotal < 1 || afterTotal !== expectedTotal) {
                return { confirmed: false, reason: 'source_panel_ambiguous' };
            }
            if (
                !doesInventoryContainAllSurvivors(originalInventory, inventory, source)
            ) {
                return { confirmed: false, reason: 'source_panel_ambiguous' };
            }

            return {
                confirmed: true,
                reason: '',
                rowCount: inventory.rowCount,
                totalHint: afterTotal,
                identitySignature: inventory.identitySignature
            };
        }

        async function waitForNativeSourceAbsenceEvidence(
            sourceKey,
            source,
            originalRow = null,
            maxAttempts = 10,
            delayMs = 100,
            options = {}
        ) {
            let lastResult = { confirmed: false, reason: 'delete_verification_timeout' };
            let stableEvidenceCount = 0;
            let stableIdentitySignature = null;

            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                if (options.operation || typeof options.validateOperation === 'function') {
                    const operationState = typeof options.validateOperation === 'function'
                        ? options.validateOperation()
                        : nativeActionCoordinator?.validateOperation?.(options.operation);
                    if (operationState && !operationState.ok) {
                        return { confirmed: false, reason: operationState.reason };
                    }
                }
                lastResult = getNativeDeleteAbsenceEvidence(
                    sourceKey,
                    source,
                    originalRow,
                    options.originalInventory || null
                );
                if (lastResult.confirmed) {
                    const evidenceSignature = `${lastResult.identitySignature}|${lastResult.totalHint}`;
                    if (stableIdentitySignature === evidenceSignature) {
                        stableEvidenceCount += 1;
                    } else {
                        stableIdentitySignature = evidenceSignature;
                        stableEvidenceCount = 1;
                    }
                    if (stableEvidenceCount >= 2) {
                        return lastResult;
                    }
                } else {
                    stableEvidenceCount = 0;
                    stableIdentitySignature = null;
                }
                if (attempt < maxAttempts - 1) {
                    await new Promise((resolve) => setTimeout(resolve, delayMs));
                }
            }

            return {
                confirmed: false,
                reason: lastResult.reason || 'delete_verification_timeout'
            };
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

        function triggerNativeSourceDetailsDirectWithResult(sourceKey, options = {}) {
            const source = getSourcesByKey().get(sourceKey);
            if (!source || source.isDisabled || source.isLoading) {
                return createNativeActionResult(false, 'source_unavailable');
            }
            const acquired = acquireNativeActionOperation('details', sourceKey, source, options);
            if (!acquired.ok) {
                return createNativeActionResult(false, acquired.reason);
            }

            try {
                const operationState = validateNativeActionOperation(acquired, 'details', sourceKey);
                if (!operationState.ok) {
                    return createNativeActionResult(false, operationState.reason);
                }
                const row = resolveFreshSourceRow(sourceKey);
                if (!row) return createNativeActionResult(false, 'source_row_missing');

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
                    const currentState = validateNativeActionOperation(acquired, 'details', sourceKey);
                    if (!currentState.ok) {
                        return createNativeActionResult(false, currentState.reason);
                    }
                    if (dispatchSyntheticActivation(candidate)) {
                        return createNativeActionResult(true);
                    }
                }

                return createNativeActionResult(false, 'details_target_missing');
            } finally {
                releaseNativeActionOperation(acquired);
            }
        }

        function triggerNativeSourceDetailsDirect(sourceKey) {
            return triggerNativeSourceDetailsDirectWithResult(sourceKey).ok;
        }

        async function waitForNativeMenuItems(existingFingerprints = new Set(), maxAttempts = 6, delayMs = 100, options = {}) {
            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                if (options.operation || typeof options.validateOperation === 'function') {
                    const operationState = typeof options.validateOperation === 'function'
                        ? options.validateOperation()
                        : nativeActionCoordinator?.validateOperation?.(options.operation);
                    if (operationState && !operationState.ok) return [];
                }
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

        async function triggerNativeSourceDetailsViaNativeMenuWithResult(sourceKey, options = {}) {
            const source = getSourcesByKey().get(sourceKey);
            if (!source || source.isDisabled || source.isLoading) {
                return createNativeActionResult(false, 'source_unavailable');
            }
            const acquired = acquireNativeActionOperation('details', sourceKey, source, options);
            if (!acquired.ok) {
                return createNativeActionResult(false, acquired.reason);
            }

            try {
                let operationState = validateNativeActionOperation(acquired, 'details', sourceKey);
                if (!operationState.ok) {
                    return createNativeActionResult(false, operationState.reason);
                }
                const nativeMoreBtn = findNativeSourceMenuButton(sourceKey);
                if (!nativeMoreBtn || typeof nativeMoreBtn.click !== 'function') {
                    return createNativeActionResult(false, 'menu_button_missing');
                }

                const existingMenuFingerprints = new Set(
                    queryNativeMenuItems().map((item) => getNativeMenuItemFingerprint(item))
                );
                nativeMoreBtn.click();
                const menuItems = await waitForNativeMenuItems(
                    existingMenuFingerprints,
                    6,
                    100,
                    {
                        operation: acquired.operation,
                        validateOperation: () => validateNativeActionOperation(
                            acquired,
                            'details',
                            sourceKey
                        )
                    }
                );
                operationState = validateNativeActionOperation(acquired, 'details', sourceKey);
                if (!operationState.ok) {
                    return createNativeActionResult(false, operationState.reason);
                }
                const menuResult = resolveNativeActionMenuItem(menuItems, 'source-details', {
                    allowSingleSafeFallback: true
                });
                const detailsMenuItem = menuResult.item;
                if (!detailsMenuItem || typeof detailsMenuItem.click !== 'function') {
                    closeNativeOverlay(acquired.operation);
                    if (menuResult.reason === 'native_menu_ambiguous') {
                        return createNativeActionResult(false, 'details_menu_ambiguous');
                    }
                    const directResult = triggerNativeSourceDetailsDirectWithResult(sourceKey, {
                        operation: acquired.operation
                    });
                    return directResult.ok ? directResult : createNativeActionResult(false, 'details_menu_missing');
                }

                operationState = validateNativeActionOperation(acquired, 'details', sourceKey);
                if (!operationState.ok) {
                    return createNativeActionResult(false, operationState.reason);
                }
                detailsMenuItem.click();
                return createNativeActionResult(true);
            } catch (error) {
                developerLog('error', 'native_action', 'details_failed', {
                    action: 'details',
                    sourceKey,
                    reason: 'native_action_error'
                });
                closeNativeOverlay(acquired.operation);
                const directResult = triggerNativeSourceDetailsDirectWithResult(sourceKey, {
                    operation: acquired.operation
                });
                return directResult.ok ? directResult : createNativeActionResult(false, 'native_action_error');
            } finally {
                releaseNativeActionOperation(acquired);
            }
        }

        async function triggerNativeSourceDetailsViaNativeMenu(sourceKey) {
            const result = await triggerNativeSourceDetailsViaNativeMenuWithResult(sourceKey);
            return Boolean(result && result.ok);
        }

        async function triggerNativeSourceRenameWithResult(sourceKey, options = {}) {
            const source = getSourcesByKey().get(sourceKey);
            if (!source || source.isDisabled || source.isLoading) {
                return createNativeActionResult(false, 'source_unavailable');
            }
            const acquired = acquireNativeActionOperation('rename', sourceKey, source, options);
            if (!acquired.ok) {
                return createNativeActionResult(false, acquired.reason);
            }

            try {
                let operationState = validateNativeActionOperation(acquired, 'rename', sourceKey);
                if (!operationState.ok) {
                    return createNativeActionResult(false, operationState.reason);
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
                const menuItems = await waitForNativeMenuItems(
                    existingMenuFingerprints,
                    6,
                    100,
                    {
                        operation: acquired.operation,
                        validateOperation: () => validateNativeActionOperation(
                            acquired,
                            'rename',
                            sourceKey
                        )
                    }
                );
                operationState = validateNativeActionOperation(acquired, 'rename', sourceKey);
                if (!operationState.ok) {
                    return createNativeActionResult(false, operationState.reason);
                }
                const menuResult = resolveNativeActionMenuItem(menuItems, 'rename');
                const renameMenuItem = menuResult.item;
                if (!renameMenuItem || typeof renameMenuItem.click !== 'function') {
                    closeNativeOverlay(acquired.operation);
                    return createNativeActionResult(
                        false,
                        menuResult.reason === 'native_menu_ambiguous'
                            ? 'rename_menu_ambiguous'
                            : 'rename_menu_missing'
                    );
                }

                const freshRowResult = resolveValidatedNativeSourceRow(sourceKey);
                if (!freshRowResult.row) {
                    closeNativeOverlay(acquired.operation);
                    return createNativeActionResult(
                        false,
                        freshRowResult.reason || 'source_row_missing'
                    );
                }
                const existingDialogSnapshot = createNativeDialogSnapshot(
                    queryNativeDialogs()
                );
                renameMenuItem.click();
                const watcherResult = await Promise.resolve(onNativeSourceRenameStarted(
                    sourceKey,
                    {
                        operationId: acquired.operation?.operationId || '',
                        existingDialogSnapshot
                    }
                ));
                if (watcherResult === false) {
                    return createNativeActionResult(false, 'rename_watch_failed');
                }
                operationState = validateNativeActionOperation(acquired, 'rename', sourceKey, {
                    allowIdentityChange: true
                });
                if (!operationState.ok) {
                    return createNativeActionResult(false, operationState.reason);
                }
                return createNativeActionResult(true);
            } catch (error) {
                developerLog('error', 'native_action', 'rename_failed', {
                    action: 'rename',
                    sourceKey,
                    reason: 'native_action_error'
                });
                closeNativeOverlay(acquired.operation);
                return createNativeActionResult(false, 'native_action_error');
            } finally {
                releaseNativeActionOperation(acquired);
            }
        }

        async function triggerNativeSourceRename(sourceKey) {
            const result = await triggerNativeSourceRenameWithResult(sourceKey);
            return Boolean(result && result.ok);
        }

        async function deleteNativeSource(sourceKey, options = {}) {
            const source = getSourcesByKey().get(sourceKey);
            developerLog('info', 'native_action', 'delete_started', { sourceKey });
            if (!source) {
                developerLog('warn', 'native_action', 'delete_failed', { sourceKey, reason: 'source_missing' });
                return { deleted: false, reason: 'source_missing' };
            }
            if (source.isLoading || (source.isDisabled && !source.isFailed)) {
                developerLog('warn', 'native_action', 'delete_failed', { sourceKey, reason: 'source_unavailable' });
                return { deleted: false, reason: 'source_unavailable' };
            }
            const acquired = acquireNativeActionOperation('delete', sourceKey, source, options);
            if (!acquired.ok) {
                return { deleted: false, reason: acquired.reason };
            }

            try {
                let operationState = validateNativeActionOperation(acquired, 'delete', sourceKey);
                if (!operationState.ok) {
                    return { deleted: false, reason: operationState.reason };
                }
                const rowResult = resolveValidatedNativeSourceRow(sourceKey);
                if (!rowResult.row) {
                    developerLog('warn', 'native_action', 'delete_failed', {
                        sourceKey,
                        reason: rowResult.reason || 'source_row_missing'
                    });
                    return { deleted: false, reason: rowResult.reason || 'source_row_missing' };
                }
                const nativeMoreBtn = findNativeMoreButtonInRow(rowResult.row);
                if (!nativeMoreBtn || typeof nativeMoreBtn.click !== 'function') {
                    developerLog('warn', 'native_action', 'delete_failed', {
                        sourceKey,
                        reason: 'menu_button_missing'
                    });
                    return { deleted: false, reason: 'menu_button_missing' };
                }
                const sourceRowBeforeDelete = rowResult.row;

                const existingMenuFingerprints = new Set(
                    queryNativeMenuItems().map((item) => getNativeMenuItemFingerprint(item))
                );
                nativeMoreBtn.click();
                const menuItems = await waitForNativeMenuItems(
                    existingMenuFingerprints,
                    6,
                    100,
                    {
                        operation: acquired.operation,
                        validateOperation: () => validateNativeActionOperation(
                            acquired,
                            'delete',
                            sourceKey
                        )
                    }
                );
                operationState = validateNativeActionOperation(acquired, 'delete', sourceKey);
                if (!operationState.ok) {
                    return { deleted: false, reason: operationState.reason };
                }
                const menuResult = resolveNativeActionMenuItem(menuItems, 'delete');
                const deleteMenuItem = menuResult.item;
                if (!deleteMenuItem || typeof deleteMenuItem.click !== 'function') {
                    closeNativeOverlay(acquired.operation);
                    const reason = menuResult.reason === 'native_menu_ambiguous'
                        ? 'delete_menu_ambiguous'
                        : 'delete_menu_missing';
                    developerLog('warn', 'native_action', 'delete_failed', { sourceKey, reason });
                    return { deleted: false, reason };
                }

                const freshRowResult = resolveValidatedNativeSourceRow(sourceKey);
                if (!freshRowResult.row) {
                    closeNativeOverlay(acquired.operation);
                    const reason = freshRowResult.reason || 'source_row_missing';
                    developerLog('warn', 'native_action', 'delete_failed', { sourceKey, reason });
                    return { deleted: false, reason };
                }
                const existingDialogs = createNativeDialogSnapshot(queryNativeDialogs());
                deleteMenuItem.click();

                const confirmTarget = await waitForNativeDeleteConfirmTarget(
                    existingDialogs,
                    source,
                    10,
                    100,
                    {
                        validateOperation: () => validateNativeActionOperation(
                            acquired,
                            'delete',
                            sourceKey
                        )
                    }
                );
                operationState = validateNativeActionOperation(acquired, 'delete', sourceKey);
                if (!operationState.ok) {
                    return { deleted: false, reason: operationState.reason };
                }
                if (confirmTarget.candidateDialogs.length === 0) {
                    closeNativeOverlay(acquired.operation);
                    developerLog('warn', 'native_action', 'delete_failed', { sourceKey, reason: 'confirm_dialog_missing' });
                    return { deleted: false, reason: 'confirm_dialog_missing' };
                }
                if (confirmTarget.reason) {
                    closeNativeOverlay(acquired.operation);
                    developerLog('warn', 'native_action', 'delete_failed', { sourceKey, reason: confirmTarget.reason });
                    return { deleted: false, reason: confirmTarget.reason };
                }

                const confirmDialogs = confirmTarget.confirmDialogs;
                if (confirmDialogs.length === 0) {
                    closeNativeOverlay(acquired.operation);
                    developerLog('warn', 'native_action', 'delete_failed', { sourceKey, reason: 'confirm_dialog_unmatched' });
                    return { deleted: false, reason: 'confirm_dialog_unmatched' };
                }

                const confirmButton = confirmTarget.confirmButton;
                if (!confirmButton || typeof confirmButton.click !== 'function') {
                    closeNativeOverlay(acquired.operation);
                    const reason = confirmTarget.reason || 'confirm_button_missing';
                    developerLog('warn', 'native_action', 'delete_failed', { sourceKey, reason });
                    return { deleted: false, reason };
                }
                const beforeConfirmRowResult = resolveValidatedNativeSourceRow(sourceKey);
                if (!beforeConfirmRowResult.row) {
                    closeNativeOverlay(acquired.operation);
                    const reason = beforeConfirmRowResult.reason || 'source_row_missing';
                    developerLog('warn', 'native_action', 'delete_failed', { sourceKey, reason });
                    return { deleted: false, reason };
                }

                const sourceInventoryBeforeDelete = getNativeSourceInventorySnapshot();
                const inventoryPreflight = getNativeDeleteInventoryPreflight(
                    sourceInventoryBeforeDelete,
                    source
                );
                if (!inventoryPreflight.ok) {
                    closeNativeOverlay(acquired.operation);
                    developerLog('warn', 'native_action', 'delete_failed', {
                        sourceKey,
                        reason: inventoryPreflight.reason
                    });
                    return { deleted: false, reason: inventoryPreflight.reason };
                }

                confirmButton.click();
                developerLog('info', 'native_action', 'delete_confirm_clicked', { sourceKey });
                const confirmDialogClosed = await waitForNativeDialogsToClose(
                    confirmDialogs,
                    8,
                    100,
                    {
                        validateOperation: () => validateNativeActionOperation(
                            acquired,
                            'delete',
                            sourceKey
                        )
                    }
                );
                operationState = validateNativeActionOperation(acquired, 'delete', sourceKey);
                if (!operationState.ok) {
                    return { deleted: false, reason: operationState.reason };
                }
                if (!confirmDialogClosed) {
                    developerLog('warn', 'native_action', 'delete_failed', {
                        sourceKey,
                        reason: 'delete_not_confirmed',
                        verificationReason: 'confirm_dialog_still_open',
                        dialogClosed: false
                    });
                    return { deleted: false, reason: 'delete_not_confirmed' };
                }
                const absenceEvidence = await waitForNativeSourceAbsenceEvidence(
                    sourceKey,
                    source,
                    sourceRowBeforeDelete,
                    10,
                    75,
                    {
                        operation: acquired.operation,
                        validateOperation: () => validateNativeActionOperation(
                            acquired,
                            'delete',
                            sourceKey
                        ),
                        originalInventory: inventoryPreflight.inventory
                    }
                );
                if (!absenceEvidence.confirmed) {
                    if (
                        absenceEvidence.reason === 'native_action_context_changed'
                        || absenceEvidence.reason === 'native_action_stale'
                        || absenceEvidence.reason === 'native_action_source_changed'
                    ) {
                        return { deleted: false, reason: absenceEvidence.reason };
                    }
                    developerLog('warn', 'native_action', 'delete_failed', {
                        sourceKey,
                        reason: 'delete_not_confirmed',
                        verificationReason: absenceEvidence.reason,
                        dialogClosed: confirmDialogClosed
                    });
                    return { deleted: false, reason: 'delete_not_confirmed' };
                }
                markNativeSourceDeleted(sourceKey);
                let localApplied = false;
                try {
                    localApplied = onNativeSourceDeleteAccepted(sourceKey) === true;
                } catch (callbackError) {
                    localApplied = false;
                }
                if (!localApplied) {
                    developerLog('warn', 'native_action', 'delete_local_apply_failed', {
                        sourceKey,
                        reason: 'native_delete_local_apply_failed'
                    });
                    recordNativeActionFailure({
                        action: 'delete',
                        sourceKey,
                        reason: 'native_delete_local_apply_failed'
                    });
                }
                developerLog('info', 'native_action', 'delete_confirmed', {
                    sourceKey,
                    result: 'source_absent_from_complete_panel',
                    dialogClosed: confirmDialogClosed,
                    localApplied
                });
                return localApplied
                    ? { deleted: true }
                    : {
                        deleted: true,
                        localApplied: false,
                        reason: 'native_delete_local_apply_failed'
                    };
            } catch (error) {
                closeNativeOverlay(acquired.operation);
                developerLog('error', 'native_action', 'delete_failed', {
                    sourceKey,
                    reason: 'native_delete_error'
                });
                return { deleted: false, reason: 'native_delete_error' };
            } finally {
                releaseNativeActionOperation(acquired);
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
                    console.error('GeminiNotebook-Source-Management: Source details open request failed.', error);
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
                    console.error('GeminiNotebook-Source-Management: Source rename request failed.', error);
                    showNativeActionFailureToast('rename', sourceKey, 'native_action_error', renameNativeSourceFromAction);
                });

            return true;
        }

        function deleteNativeSourceFromAction(sourceKey) {
            Promise.resolve(deleteNativeSource(sourceKey))
                .then((result) => {
                    if (result && result.deleted && result.localApplied !== false) {
                        showToast(getMessage('ui_native_deleted_irreversible'), { variant: 'success' });
                        render();
                        return;
                    }
                    if (result && result.deleted) {
                        showToast(getMessage('ui_native_deleted_local_reconcile_failed'), {
                            variant: 'error'
                        });
                        render();
                        return;
                    }
                    showNativeActionFailureToast('delete', sourceKey, result?.reason || 'native_delete_error', deleteNativeSourceFromAction);
                })
                .catch((error) => {
                    console.error('GeminiNotebook-Source-Management: Source delete request failed.', error);
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
            sourceActionInvokers.orderTreeItem = (sourceKey, direction) => (
                orderTreeItem(sourceKey, direction)
            );
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

            const menuItems = getSourceActionMenuItems(sourceKey);
            const parentItem = menuItems.find((item) => item.action === action);
            const childItem = menuItems
                .filter((item) => item.kind === 'submenu' && Array.isArray(item.children))
                .flatMap((item) => item.children)
                .find((item) => item.action === action);
            const menuItem = parentItem || childItem;
            if (!menuItem) {
                closeSourceActionMenu();
                return false;
            }
            if (menuItem?.disabled) {
                closeSourceActionMenu();
                showToast(getMessage('ui_keyboard_move_unavailable'), { variant: 'info' });
                return false;
            }
            if (menuItem.kind === 'submenu') {
                activeSourceActionSourceKey = sourceKey;
                activeSourceActionSubmenuAction = menuItem.action;
                return true;
            }

            closeSourceActionMenu();

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
            case 'tree-order-up':
            case 'tree-order-down':
            case 'tree-order-in':
            case 'tree-order-out':
                return sourceActionInvokers.orderTreeItem(sourceKey, menuItem.direction);
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
            containsBoundarySafeSourceTitle,
            getDialogSourceTitleMatchState,
            getNativeDeleteMenuItemScore,
            getNativeRenameMenuItemScore,
            scoreNativeMenuItemAction,
            resolveNativeActionMenuItem,
            findNativeActionMenuItem,
            findNativeDeleteMenuItem,
            findNativeRenameMenuItem,
            getNativeDeleteConfirmButtonScore,
            resolveNativeDeleteConfirmButton,
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
            getNativeSourceInventorySnapshot,
            getNativeActionFailureMessage,
            showNativeActionFailureToast,
            openNativeSourceDetails,
            handleSourceActionSelection,
            getSourceActionInvokers,
            setSourceActionInvoker,
            setSourceActionInvokers,
            resetSourceActionInvokers,
            beginNativeActionSession,
            endNativeActionSession,
            cancelActiveNativeAction,
            getActiveNativeActionOperation: () => (
                nativeActionCoordinator?.getActiveOperation?.() || null
            ),
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
