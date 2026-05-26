(function () {
    'use strict';

    function createContentTreeInteractions(deps = {}) {
        const runtime = deps.runtime || deps;
        const NATIVE_SELECTION_SYNC_RETRY_LIMIT = 6;

        const getState = typeof deps.getState === 'function'
            ? deps.getState
            : () => (deps.state || runtime.state || {});
        const getGroupsById = typeof deps.getGroupsById === 'function'
            ? deps.getGroupsById
            : () => (deps.groupsById || runtime.groupsById || new Map());
        const getSourcesByKey = typeof deps.getSourcesByKey === 'function'
            ? deps.getSourcesByKey
            : () => (deps.sourcesByKey || runtime.sourcesByKey || new Map());
        const getPendingBatchKeys = typeof deps.getPendingBatchKeys === 'function'
            ? deps.getPendingBatchKeys
            : () => (deps.pendingBatchKeys || runtime.pendingBatchKeys || new Set());
        const getParentMap = typeof deps.getParentMap === 'function'
            ? deps.getParentMap
            : () => (deps.parentMap || runtime.parentMap || new Map());
        const getClickQueue = typeof deps.getClickQueue === 'function'
            ? deps.getClickQueue
            : () => (deps.clickQueue || runtime.clickQueue || []);
        const getKeyByElement = typeof deps.getKeyByElement === 'function'
            ? deps.getKeyByElement
            : () => (deps.keyByElement || runtime.keyByElement || new WeakMap());
        const getShadowRoot = typeof deps.getShadowRoot === 'function'
            ? deps.getShadowRoot
            : () => (deps.shadowRoot || runtime.shadowRoot || null);
        const getDocument = typeof deps.getDocument === 'function'
            ? deps.getDocument
            : () => (deps.document || runtime.document || globalThis.document || null);
        const getWindow = typeof deps.getWindow === 'function'
            ? deps.getWindow
            : () => (deps.window || runtime.window || globalThis.window || null);
        const getSetTimeout = typeof deps.getSetTimeout === 'function'
            ? deps.getSetTimeout
            : () => (deps.setTimeout || runtime.setTimeout || globalThis.setTimeout || null);
        const getDEPS = typeof deps.getDEPS === 'function'
            ? deps.getDEPS
            : () => (deps.DEPS || runtime.DEPS || {});
        const getSourceCheckboxSelector = typeof deps.getSourceCheckboxSelector === 'function'
            ? deps.getSourceCheckboxSelector
            : () => (deps.SOURCE_CHECKBOX_SELECTOR || runtime.SOURCE_CHECKBOX_SELECTOR || '.sp-checkbox');
        const getMessage = typeof deps.getMessage === 'function'
            ? deps.getMessage
            : (key, args) => {
                if (typeof runtime.getMessage === 'function') return runtime.getMessage(key, args);
                return key;
            };
        const showToast = typeof deps.showToast === 'function'
            ? deps.showToast
            : (typeof runtime.showToast === 'function' ? runtime.showToast : () => {});
        const showUndoableToast = typeof deps.showUndoableToast === 'function'
            ? deps.showUndoableToast
            : showToast;
        const render = typeof deps.render === 'function'
            ? deps.render
            : (typeof runtime.render === 'function' ? runtime.render : () => {});
        const saveState = typeof deps.saveState === 'function'
            ? deps.saveState
            : (typeof runtime.saveState === 'function' ? runtime.saveState : () => {});
        const buildParentMap = typeof deps.buildParentMap === 'function'
            ? deps.buildParentMap
            : (typeof runtime.buildParentMap === 'function' ? runtime.buildParentMap : () => {});
        const isSourceEffectivelyEnabled = typeof deps.isSourceEffectivelyEnabled === 'function'
            ? deps.isSourceEffectivelyEnabled
            : (typeof runtime.isSourceEffectivelyEnabled === 'function' ? runtime.isSourceEffectivelyEnabled : () => true);
        const collectEffectiveSourceStates = typeof deps.collectEffectiveSourceStates === 'function'
            ? deps.collectEffectiveSourceStates
            : (typeof runtime.collectEffectiveSourceStates === 'function' ? runtime.collectEffectiveSourceStates : () => new Map());
        const syncSourcesToEffectiveState = typeof deps.syncSourcesToEffectiveState === 'function'
            ? deps.syncSourcesToEffectiveState
            : (typeof runtime.syncSourcesToEffectiveState === 'function' ? runtime.syncSourcesToEffectiveState : () => {});
        const executeBatchDelete = typeof deps.executeBatchDelete === 'function'
            ? deps.executeBatchDelete
            : (typeof runtime.executeBatchDelete === 'function' ? runtime.executeBatchDelete : () => {});
        const renderMoveToFolderModal = typeof deps.renderMoveToFolderModal === 'function'
            ? deps.renderMoveToFolderModal
            : (typeof runtime.renderMoveToFolderModal === 'function' ? runtime.renderMoveToFolderModal : () => {});
        const renderBatchTagModal = typeof deps.renderBatchTagModal === 'function'
            ? deps.renderBatchTagModal
            : (typeof runtime.renderBatchTagModal === 'function' ? runtime.renderBatchTagModal : () => {});
        const getSourceActionInvokers = typeof deps.getSourceActionInvokers === 'function'
            ? deps.getSourceActionInvokers
            : () => (deps.sourceActionInvokers || runtime.sourceActionInvokers || {});
        const handleSourceActionSelection = typeof deps.handleSourceActionSelection === 'function'
            ? deps.handleSourceActionSelection
            : (typeof runtime.handleSourceActionSelection === 'function' ? runtime.handleSourceActionSelection : () => {});
        const applyNativeLabelImportFromUi = typeof deps.applyNativeLabelImportFromUi === 'function'
            ? deps.applyNativeLabelImportFromUi
            : (typeof runtime.applyNativeLabelImportFromUi === 'function' ? runtime.applyNativeLabelImportFromUi : () => false);
        const toggleSourceActionMenu = typeof deps.toggleSourceActionMenu === 'function'
            ? deps.toggleSourceActionMenu
            : (typeof runtime.toggleSourceActionMenu === 'function' ? runtime.toggleSourceActionMenu : () => {});
        const closeSourceActionMenu = typeof deps.closeSourceActionMenu === 'function'
            ? deps.closeSourceActionMenu
            : (typeof runtime.closeSourceActionMenu === 'function' ? runtime.closeSourceActionMenu : () => {});
        const findFreshCheckbox = typeof deps.findFreshCheckbox === 'function'
            ? deps.findFreshCheckbox
            : (typeof runtime.findFreshCheckbox === 'function' ? runtime.findFreshCheckbox : () => null);
        const resolveFreshRowEntry = typeof deps.resolveFreshRowEntry === 'function'
            ? deps.resolveFreshRowEntry
            : (typeof runtime.resolveFreshRowEntry === 'function' ? runtime.resolveFreshRowEntry : null);
        const isDescendant = typeof deps.isDescendant === 'function'
            ? deps.isDescendant
            : (typeof runtime.isDescendant === 'function' ? runtime.isDescendant : () => false);
        const getIsProcessingQueue = typeof deps.getIsProcessingQueue === 'function'
            ? deps.getIsProcessingQueue
            : () => Boolean(deps.isProcessingQueue ?? runtime.isProcessingQueue);
        const setIsProcessingQueue = typeof deps.setIsProcessingQueue === 'function'
            ? deps.setIsProcessingQueue
            : (value) => {
                if (deps.runtime && Object.prototype.hasOwnProperty.call(deps.runtime, 'isProcessingQueue')) {
                    deps.runtime.isProcessingQueue = Boolean(value);
                } else {
                    deps.isProcessingQueue = Boolean(value);
                }
            };
        const getIsSyncingState = typeof deps.getIsSyncingState === 'function'
            ? deps.getIsSyncingState
            : () => Boolean(deps.isSyncingState ?? runtime.isSyncingState);
        const setIsSyncingState = typeof deps.setIsSyncingState === 'function'
            ? deps.setIsSyncingState
            : (value) => {
                if (deps.runtime && Object.prototype.hasOwnProperty.call(deps.runtime, 'isSyncingState')) {
                    deps.runtime.isSyncingState = Boolean(value);
                } else {
                    deps.isSyncingState = Boolean(value);
                }
            };
        const getActiveIsolationGroupId = typeof deps.getActiveIsolationGroupId === 'function'
            ? deps.getActiveIsolationGroupId
            : () => (deps.activeIsolationGroupId ?? runtime.activeIsolationGroupId ?? null);
        const setActiveIsolationGroupId = typeof deps.setActiveIsolationGroupId === 'function'
            ? deps.setActiveIsolationGroupId
            : (value) => {
                if (deps.runtime && Object.prototype.hasOwnProperty.call(deps.runtime, 'activeIsolationGroupId')) {
                    deps.runtime.activeIsolationGroupId = value;
                } else {
                    deps.activeIsolationGroupId = value;
                }
            };
        const getIsDeletingSources = typeof deps.getIsDeletingSources === 'function'
            ? deps.getIsDeletingSources
            : () => Boolean(deps.isDeletingSources ?? runtime.isDeletingSources);
        const getCurrentSourceViewKind = typeof deps.getCurrentSourceViewKind === 'function'
            ? deps.getCurrentSourceViewKind
            : () => (deps.sourceViewKind || runtime.sourceViewKind || null);
        const recordNativeSelectionSyncFailure = typeof deps.recordNativeSelectionSyncFailure === 'function'
            ? deps.recordNativeSelectionSyncFailure
            : () => {};
        const developerLog = typeof deps.developerLog === 'function'
            ? deps.developerLog
            : (typeof runtime.developerLog === 'function' ? runtime.developerLog : () => false);

        const dragMulti = (typeof deps.dragMulti === 'object' && deps.dragMulti)
            ? deps.dragMulti
            : (typeof runtime.dragMulti === 'object' && runtime.dragMulti
                ? runtime.dragMulti
                : (typeof globalThis.NSM_CREATE_CONTENT_DRAG_MULTI === 'function'
                    ? globalThis.NSM_CREATE_CONTENT_DRAG_MULTI({})
                    : null));

        if (typeof runtime.activeDragContext === 'undefined') {
            runtime.activeDragContext = null;
        }

        const autoScrollController = dragMulti && typeof dragMulti.createAutoScrollController === 'function'
            ? dragMulti.createAutoScrollController({
                getContainer: () => {
                    const root = getShadowRoot();
                    return root && typeof root.getElementById === 'function' ? root.getElementById('sources-list') : null;
                }
            })
            : null;

        function cssEscape(value) {
            const raw = typeof value === 'string' ? value : String(value ?? '');
            if (typeof globalThis.CSS === 'object' && globalThis.CSS && typeof globalThis.CSS.escape === 'function') {
                try { return globalThis.CSS.escape(raw); } catch (err) { /* fall through */ }
            }
            return raw.replace(/(["\\])/g, '\\$1');
        }

        const createContentNativeCheckboxSyncFactory = globalThis.NSM_CREATE_CONTENT_NATIVE_CHECKBOX_SYNC;
        if (typeof createContentNativeCheckboxSyncFactory !== 'function') {
            throw new Error('NotebookLM Source Management: createContentTreeInteractions requires NSM_CREATE_CONTENT_NATIVE_CHECKBOX_SYNC to be loaded first.');
        }
        const {
            getNativeCheckboxState,
            shouldToggleNativeCheckbox,
            resolveDetachedRowEntry
        } = createContentNativeCheckboxSyncFactory({ findFreshCheckbox, resolveFreshRowEntry });

        function createUniqueGroupId(groupsById) {
            const baseId = `group_${Date.now()}`;
            if (!groupsById.has(baseId)) return baseId;

            let suffix = 1;
            let candidate = `${baseId}_${suffix}`;
            while (groupsById.has(candidate)) {
                suffix += 1;
                candidate = `${baseId}_${suffix}`;
            }
            return candidate;
        }

        function handleAddNewGroup(parentGroupId = null) {
            const state = getState();
            const groupsById = getGroupsById();
            const parent = parentGroupId ? groupsById.get(parentGroupId) : null;
            if (parentGroupId && !parent) {
                return false;
            }

            const newGroup = {
                id: createUniqueGroupId(groupsById),
                title: parentGroupId ? getMessage('ui_new_subgroup') : getMessage('ui_new_group'),
                children: [],
                enabled: true,
                collapsed: false,
                isNewlyCreated: true
            };

            groupsById.set(newGroup.id, newGroup);
            if (parentGroupId) {
                parent.children.push({ type: 'group', id: newGroup.id });
            } else {
                state.groups = Array.isArray(state.groups) ? state.groups : [];
                state.groups.push(newGroup.id);
            }

            buildParentMap();
            render();
            saveState({ immediate: true, critical: true });
            return true;
        }

        function syncSourceToPage(source, desiredState, options = {}) {
            if (!source) return false;

            const documentObj = getDocument();
            const currentSourceViewKind = options.currentSourceViewKind || getCurrentSourceViewKind();
            if (currentSourceViewKind === 'label') {
                recordNativeSelectionSyncFailure({
                    sourceKey: source.key || '',
                    reason: 'not_list_view',
                    detectedSourceViewKind: currentSourceViewKind
                });
                return false;
            }

            let checkbox = null;
            if (options.preferStoredCheckbox && source.checkbox && documentObj?.body?.contains?.(source.checkbox)) {
                checkbox = source.checkbox;
            } else if (options.preferStoredCheckbox) {
                checkbox = source.element?.querySelector?.(getSourceCheckboxSelector()) || null;
            } else {
                const resolvedEntry = resolveDetachedRowEntry(source);
                if (resolvedEntry?.checkbox) {
                    checkbox = resolvedEntry.checkbox;
                    source.element = resolvedEntry.row || source.element;
                    source.checkbox = resolvedEntry.checkbox;
                } else {
                    checkbox = source.element?.querySelector?.(getSourceCheckboxSelector()) || null;
                }
            }

            if (!checkbox || !documentObj?.body?.contains?.(checkbox)) {
                if (options.retryOnMissingCheckbox === true && currentSourceViewKind !== 'label') {
                    getClickQueue().push({
                        checkbox: null,
                        desiredState,
                        sourceKey: source.key,
                        retryOnMissing: true,
                        attempts: 0
                    });
                    if (!getIsProcessingQueue()) processClickQueue();
                    return true;
                }

                recordNativeSelectionSyncFailure({
                    sourceKey: source.key || '',
                    reason: 'native_checkbox_missing',
                    detectedSourceViewKind: currentSourceViewKind || 'unknown'
                });
                return false;
            }

            if (shouldToggleNativeCheckbox(checkbox, desiredState)) {
                getClickQueue().push({ checkbox, desiredState, sourceKey: source.key });
            }

            recordNativeSelectionSyncFailure(null);
            if (!getIsProcessingQueue()) processClickQueue();
            return true;
        }

        function processClickQueue() {
            const clickQueue = getClickQueue();
            const documentObj = getDocument();
            const setTimeoutFn = getSetTimeout();

            if (clickQueue.length === 0) {
                setIsProcessingQueue(false);
                setIsSyncingState(false);
                return;
            }

            setIsProcessingQueue(true);
            setIsSyncingState(true);

            const batchSize = 5;
            for (let i = 0; i < batchSize && clickQueue.length > 0; i++) {
                const item = clickQueue.shift();
                let checkbox = item.checkbox;

                if (!checkbox || !documentObj?.body?.contains?.(checkbox)) {
                    const freshCheckbox = findFreshCheckbox(item.sourceKey);
                    if (freshCheckbox) {
                        checkbox = freshCheckbox;
                    } else if (item.retryOnMissing && Number(item.attempts) < NATIVE_SELECTION_SYNC_RETRY_LIMIT) {
                        clickQueue.push(Object.assign({}, item, {
                            attempts: Number(item.attempts) + 1
                        }));
                        continue;
                    } else {
                        recordNativeSelectionSyncFailure({
                            sourceKey: item.sourceKey || '',
                            reason: 'native_checkbox_missing_during_queue',
                            detectedSourceViewKind: getCurrentSourceViewKind() || 'unknown'
                        });
                        continue;
                    }
                }

                if (shouldToggleNativeCheckbox(checkbox, item.desiredState)) {
                    recordNativeSelectionSyncFailure(null);
                    checkbox.click();
                }
            }

            if (typeof setTimeoutFn === 'function') {
                setTimeoutFn(processClickQueue, 20);
            }
        }

        function findParentGroupOfSource(key) {
            const parentMap = getParentMap();
            const groupsById = getGroupsById();
            const parentId = parentMap.get(key);
            return parentId ? (groupsById.get(parentId) || null) : null;
        }

        function removeSourceFromTree(key) {
            const state = getState();
            const parentGroup = findParentGroupOfSource(key);
            if (parentGroup) {
                parentGroup.children = (Array.isArray(parentGroup.children) ? parentGroup.children : [])
                    .filter((c) => c.type === 'group' || c.key !== key);
            } else {
                state.ungrouped = (Array.isArray(state.ungrouped) ? state.ungrouped : []).filter((k) => k !== key);
            }
        }

        function isBatchOperableSource(source) {
            return Boolean(source && !source.isDisabled && !source.isLoading);
        }

        function collectSourceKeysInTreeOrder() {
            const state = getState();
            const groupsById = getGroupsById();
            const orderedKeys = [];
            const visitGroup = (groupId) => {
                const group = groupsById.get(groupId);
                if (!group || !Array.isArray(group.children)) return;
                group.children.forEach((child) => {
                    if (child.type === 'source' && child.key) {
                        orderedKeys.push(child.key);
                    } else if (child.type === 'group' && child.id) {
                        visitGroup(child.id);
                    }
                });
            };

            (Array.isArray(state.groups) ? state.groups : []).forEach(visitGroup);
            (Array.isArray(state.ungrouped) ? state.ungrouped : []).forEach((sourceKey) => {
                if (sourceKey) orderedKeys.push(sourceKey);
            });
            return orderedKeys;
        }

        function finishSuccessfulBatchOperation(messageKey, count) {
            const state = getState();
            const pendingBatchKeys = getPendingBatchKeys();
            pendingBatchKeys.clear();
            state.isBatchMode = false;
            closeSourceActionMenu();
            saveState({ immediate: true, critical: true });
            render();
            showUndoableToast(getMessage(messageKey, [String(count)]), { variant: 'success' });
        }

        function executeBatchMoveToUngrouped() {
            const state = getState();
            const sourcesByKey = getSourcesByKey();
            const pendingBatchKeys = getPendingBatchKeys();
            const selectedKeys = new Set(pendingBatchKeys);
            const movableKeys = collectSourceKeysInTreeOrder().filter((sourceKey) => {
                const source = sourcesByKey.get(sourceKey);
                return selectedKeys.has(sourceKey) &&
                    isBatchOperableSource(source) &&
                    Boolean(findParentGroupOfSource(sourceKey));
            });

            if (movableKeys.length === 0) {
                showToast(getMessage('ui_batch_no_sources_changed'), { variant: 'info' });
                return false;
            }

            state.ungrouped = Array.isArray(state.ungrouped) ? state.ungrouped : [];
            movableKeys.forEach((sourceKey) => {
                removeSourceFromTree(sourceKey);
                if (!state.ungrouped.includes(sourceKey)) {
                    state.ungrouped.push(sourceKey);
                }
            });
            buildParentMap();
            finishSuccessfulBatchOperation('ui_batch_ungrouped_toast', movableKeys.length);
            return true;
        }

        function finishKeyboardTreeMove(messageKey) {
            closeSourceActionMenu();
            buildParentMap();
            render();
            saveState({ immediate: true, critical: true });
            showUndoableToast(getMessage(messageKey), { variant: 'success' });
        }

        function canMoveSourceToUngrouped(sourceKey) {
            const source = getSourcesByKey().get(sourceKey);
            return Boolean(isBatchOperableSource(source) && findParentGroupOfSource(sourceKey));
        }

        function moveSourceToUngrouped(sourceKey) {
            const state = getState();
            if (!canMoveSourceToUngrouped(sourceKey)) {
                showToast(getMessage('ui_keyboard_move_unavailable'), { variant: 'info' });
                return false;
            }

            state.ungrouped = Array.isArray(state.ungrouped) ? state.ungrouped : [];
            removeSourceFromTree(sourceKey);
            if (!state.ungrouped.includes(sourceKey)) {
                state.ungrouped.push(sourceKey);
            }
            finishKeyboardTreeMove('ui_keyboard_moved_ungrouped_toast');
            return true;
        }

        function removeGroupFromTree(id) {
            const state = getState();
            const groupsById = getGroupsById();
            state.groups = (Array.isArray(state.groups) ? state.groups : []).filter((gid) => gid !== id);
            groupsById.forEach((group) => {
                group.children = (Array.isArray(group.children) ? group.children : []).filter((c) => c.id !== id);
            });
        }

        function toggleGroupCollapse(group, groupContainer) {
            if (!group || !groupContainer) return;
            const save = saveState;
            group.collapsed = !group.collapsed;

            const caret = groupContainer.querySelector('.sp-caret');
            const childrenContainer = groupContainer.querySelector('.group-children');
            if (!caret || !childrenContainer) {
                save({ immediate: true });
                return;
            }

            if (group.collapsed) {
                caret.classList.add('collapsed');
                childrenContainer.style.overflow = 'hidden';
                childrenContainer.style.height = `${childrenContainer.scrollHeight}px`;
                childrenContainer.offsetHeight;
                childrenContainer.style.height = '0px';
                childrenContainer.classList.add('collapsed');
            } else {
                caret.classList.remove('collapsed');
                childrenContainer.classList.remove('collapsed');
                childrenContainer.style.overflow = 'hidden';
                childrenContainer.style.height = `${childrenContainer.scrollHeight}px`;

                childrenContainer.addEventListener('transitionend', function handler() {
                    childrenContainer.style.height = 'auto';
                    childrenContainer.style.overflow = 'visible';
                    childrenContainer.removeEventListener('transitionend', handler);
                });
            }

            save({ immediate: true });
        }

        function handleInteraction(event) {
            const state = getState();
            const groupsById = getGroupsById();
            const sourcesByKey = getSourcesByKey();
            const pendingBatchKeys = getPendingBatchKeys();
            const target = event.target;
            const groupContainer = target.closest('.group-container');
            const groupId = groupContainer?.dataset.groupId;
            const sourceRow = target.closest('.source-item');
            const sourceKey = sourceRow?.dataset.sourceKey;
            const sourceActionsButton = target.closest('.sp-source-actions-button');
            const sourceActionsMenuItem = target.closest('.sp-source-actions-menu-item');
            const isolationGroupId = getActiveIsolationGroupId();

            if (sourceActionsMenuItem) {
                handleSourceActionSelection(sourceActionsMenuItem.dataset.sourceKey, sourceActionsMenuItem.dataset.action);
                render();
                return;
            }

            if (sourceActionsButton) {
                toggleSourceActionMenu(sourceActionsButton.dataset.sourceKey, sourceActionsButton);
                render();
                return;
            }

            if (target.closest('.sp-tag-pill')) {
                const tagId = target.closest('.sp-tag-pill').dataset.tagId;
                state.activeTagId = state.activeTagId === tagId ? null : tagId;
                state.activeQuickViewKind = null;
                render();
                return;
            }

            if (target.closest('#sp-clear-isolate-btn')) {
                const oldStates = collectEffectiveSourceStates();
                setActiveIsolationGroupId(null);
                syncSourcesToEffectiveState(oldStates);
                render();
                showToast(getMessage('ui_isolation_cleared_toast'));
                return;
            }

            if (target.closest('#sp-clear-tag-filter-btn')) {
                state.activeTagId = null;
                render();
                return;
            }

            if (target.closest('#sp-import-native-labels-btn')) {
                Promise.resolve(applyNativeLabelImportFromUi()).catch((error) => {
                    console.error('NotebookLM Source Management: Failed to prepare native label import preview.', error);
                });
                return;
            }

            if (target.closest('.sp-add-subgroup-button')) {
                handleAddNewGroup(groupId);
                return;
            }
            if (target.closest('.sp-caret')) {
                toggleGroupCollapse(groupsById.get(groupId), groupContainer);
                return;
            }
            if (target.closest('.sp-isolate-button')) {
                const oldStates = collectEffectiveSourceStates();
                setActiveIsolationGroupId(isolationGroupId === groupId ? null : groupId);
                syncSourcesToEffectiveState(oldStates);
                render();
                showToast(
                    getActiveIsolationGroupId()
                        ? getMessage('ui_isolated_toast', [groupsById.get(groupId)?.title])
                        : getMessage('ui_isolation_cleared_toast')
                );
                return;
            }

            if (target.classList.contains('sp-group-toggle-checkbox')) {
                const targetGroupId = target.dataset.groupId;
                const group = groupsById.get(targetGroupId);
                if (group) {
                    const oldEffectiveStates = collectEffectiveSourceStates();
                    group.enabled = target.checked;
                    syncSourcesToEffectiveState(oldEffectiveStates);
                    saveState({ immediate: true, critical: true });
                    render();
                }
                return;
            }

            const batchCheckbox = target.closest('.sp-batch-checkbox');
            if (batchCheckbox) {
                const batchSourceKey = batchCheckbox.dataset.sourceKey;
                const source = batchSourceKey ? sourcesByKey.get(batchSourceKey) : null;

                if (!source || source.isDisabled || source.isLoading) {
                    if (batchSourceKey) {
                        pendingBatchKeys.delete(batchSourceKey);
                    }
                    if (typeof batchCheckbox.checked === 'boolean') {
                        batchCheckbox.checked = false;
                    }
                    render();
                    return;
                }

                if (batchCheckbox.checked) {
                    pendingBatchKeys.add(batchSourceKey);
                } else {
                    pendingBatchKeys.delete(batchSourceKey);
                }
                render();
                return;
            }

            if (target.classList.contains('sp-checkbox')) {
                const checkboxSourceKey = target.dataset.sourceKey;
                if (checkboxSourceKey) {
                    const source = sourcesByKey.get(checkboxSourceKey);
                    if (source && !source.isDisabled) {
                        source.enabled = target.checked;
                        syncSourceToPage(source, isSourceEffectivelyEnabled(source), {
                            retryOnMissingCheckbox: true
                        });
                        saveState({ immediate: true, critical: true });
                        render();
                    }
                }
                return;
            }

            if (target.closest('.group-header') && !target.closest('.sp-caret, .sp-toggle-switch, .sp-add-subgroup-button, .sp-isolate-button, .sp-edit-button, .sp-delete-button, input')) {
                toggleGroupCollapse(groupsById.get(groupId), groupContainer);
                return;
            }

            if (sourceRow && !target.closest('.sp-source-actions-anchor, .sp-source-actions-menu, .sp-tag-pill, input, .sp-batch-checkbox')) {
                const source = sourcesByKey.get(sourceKey);

                if (!source || source.isDisabled) {
                    return;
                }

                if (state.isBatchMode) {
                    if (source.isLoading) {
                        return;
                    }

                    if (pendingBatchKeys.has(sourceKey)) {
                        pendingBatchKeys.delete(sourceKey);
                    } else {
                        pendingBatchKeys.add(sourceKey);
                    }
                    render();
                    return;
                }

                if (target.closest('.icon-container') && !source.isLoading) {
                    getSourceActionInvokers().openNativeDetails(sourceKey);
                    return;
                }

                const checkbox = sourceRow.querySelector('.sp-checkbox');

                if (sourceKey && checkbox) {
                    checkbox.checked = !checkbox.checked;

                    if (source) {
                        source.enabled = checkbox.checked;
                        syncSourceToPage(source, isSourceEffectivelyEnabled(source), {
                            retryOnMissingCheckbox: true
                        });
                        saveState({ immediate: true, critical: true });
                        render();
                    }
                }
                return;
            }

            if (target.closest('.sp-cancel-batch-btn')) {
                state.isBatchMode = false;
                pendingBatchKeys.clear();
                render();
                return;
            }

            if (target.closest('.sp-confirm-delete-btn') && !getIsDeletingSources() && pendingBatchKeys.size > 0) {
                executeBatchDelete();
                return;
            }

            if (target.closest('.sp-batch-ungroup-btn') && pendingBatchKeys.size > 0 && !getIsDeletingSources()) {
                executeBatchMoveToUngrouped();
                return;
            }

            if (target.closest('.sp-batch-add-tags-btn') && pendingBatchKeys.size > 0 && !getIsDeletingSources()) {
                renderBatchTagModal('add', pendingBatchKeys);
                return;
            }

            if (target.closest('.sp-batch-remove-tags-btn') && pendingBatchKeys.size > 0 && !getIsDeletingSources()) {
                renderBatchTagModal('remove', pendingBatchKeys);
                return;
            }

            if (target.closest('.sp-batch-add-folder-btn') && pendingBatchKeys.size > 0) {
                renderMoveToFolderModal(pendingBatchKeys);
                return;
            }

            const editButton = target.closest('.sp-edit-button');
            if (editButton) {
                triggerRename(groupContainer);
                return;
            }

            const deleteButton = target.closest('.sp-delete-button');
            if (deleteButton) {
                const group = groupsById.get(groupId);
                if (!group) return;
                const groupChildren = Array.isArray(group.children) ? group.children : [];

                if (groupChildren.length === 0) {
                    removeGroupFromTree(groupId);
                    groupsById.delete(groupId);
                } else {
                    const windowObj = getWindow();
                    const deleteContents = windowObj?.confirm?.(
                        getMessage('ui_delete_group_confirm_non_empty', [group.title, getMessage('ui_ungrouped')])
                    );

                    if (deleteContents) {
                        const extractChildren = (g) => {
                            (Array.isArray(g.children) ? g.children : []).forEach((c) => {
                                if (c.type === 'source') {
                                    state.ungrouped = Array.isArray(state.ungrouped) ? state.ungrouped : [];
                                    state.ungrouped.push(c.key);
                                } else {
                                    state.groups = Array.isArray(state.groups) ? state.groups : [];
                                    state.groups.push(c.id);
                                }
                            });
                        };
                        extractChildren(group);
                        removeGroupFromTree(groupId);
                        groupsById.delete(groupId);
                    } else {
                        return;
                    }
                }

                if (getActiveIsolationGroupId() === groupId) {
                    setActiveIsolationGroupId(null);
                }
                buildParentMap();
                saveState({ immediate: true, critical: true });
                render();
            }
        }

        function handleOriginalCheckboxChange(event) {
            if (getIsSyncingState()) return;
            const checkbox = event.target;
            const DEPS = getDEPS();
            const keyByElement = getKeyByElement();
            const shadowRoot = getShadowRoot();
            const sourcesByKey = getSourcesByKey();

            let validCheckbox = false;
            const checkboxSelectors = Array.isArray(DEPS.checkbox) ? DEPS.checkbox : [getSourceCheckboxSelector()];
            for (const sel of checkboxSelectors) {
                if (checkbox.matches?.(sel)) {
                    validCheckbox = true;
                    break;
                }
            }
            if (!validCheckbox) return;

            let sourceRow = null;
            const rowSelectors = Array.isArray(DEPS.row) ? DEPS.row : [];
            for (const sel of rowSelectors) {
                sourceRow = checkbox.closest(sel);
                if (sourceRow) break;
            }

            if (!sourceRow) return;
            const key = keyByElement.get(sourceRow);
            if (key) {
                const source = sourcesByKey.get(key);
                const checkboxState = getNativeCheckboxState(checkbox);
                if (checkboxState === null) return;
                if (source && source.enabled !== checkboxState) {
                    source.enabled = checkboxState;
                    const desiredState = isSourceEffectivelyEnabled(source);

                    const virtualCheckbox = shadowRoot?.querySelector?.(`.sp-checkbox[data-source-key="${key}"]`);
                    if (virtualCheckbox) {
                        virtualCheckbox.checked = source.enabled;
                    }

                    if (checkboxState !== desiredState) {
                        syncSourceToPage(source, desiredState);
                    }

                    saveState({ immediate: true, critical: true });
                    render();
                }
            }
        }

        function triggerRename(groupContainer) {
            const documentObj = getDocument();
            const groupsById = getGroupsById();
            const groupId = groupContainer.dataset.groupId;
            const group = groupsById.get(groupId);
            if (!group || !documentObj?.createElement) return;

            const titleSpan = groupContainer.querySelector('.group-title');
            const originalTitle = group.title;
            const input = documentObj.createElement('input');
            input.type = 'text';
            input.value = originalTitle;
            titleSpan.replaceChildren(input);
            input.focus();
            input.select();

            const cleanup = () => {
                input.removeEventListener('blur', handleSave);
                input.removeEventListener('keydown', handleKey);
                render();
            };
            const handleSave = () => {
                const newTitle = input.value.trim();
                if (newTitle) group.title = newTitle;
                cleanup();
                saveState({ immediate: true, critical: true });
            };
            const handleKey = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSave();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    group.title = originalTitle;
                    cleanup();
                }
            };

            input.addEventListener('blur', handleSave);
            input.addEventListener('keydown', handleKey);
        }

        function handleDragStart(e) {
            const sourceTarget = e.target.closest('.source-item');
            const groupTarget = e.target.closest('.group-header');
            const setTimeoutFn = getSetTimeout();

            if (sourceTarget) {
                const key = sourceTarget.dataset.sourceKey;
                if (!key) return;

                if (typeof e.target.closest === 'function'
                    && e.target.closest('input[type="checkbox"], .sp-batch-checkbox')) {
                    if (typeof e.preventDefault === 'function') e.preventDefault();
                    return;
                }

                const state = getState();
                const pendingBatchKeys = getPendingBatchKeys();
                const hasResolver = dragMulti && typeof dragMulti.resolveDragSelection === 'function';
                const sourceOrder = hasResolver ? collectSourceKeysInTreeOrder() : [];

                const selection = hasResolver
                    ? dragMulti.resolveDragSelection({
                        originKey: key,
                        isBatchMode: Boolean(state.isBatchMode),
                        pendingBatchKeys,
                        sourceOrder
                    })
                    : { keys: [key], isMulti: false };

                const keys = Array.isArray(selection?.keys) && selection.keys.length > 0
                    ? selection.keys
                    : [key];

                runtime.activeDragContext = selection.isMulti
                    ? { kind: 'source-multi', keys: keys.slice() }
                    : { kind: 'source-single', keys: [keys[0]] };

                e.dataTransfer.setData('application/source-key', keys[0]);
                if (selection.isMulti) {
                    e.dataTransfer.setData('application/source-keys', JSON.stringify(keys));
                }
                e.dataTransfer.effectAllowed = 'move';

                if (selection.isMulti && dragMulti && typeof dragMulti.createMultiDragGhost === 'function') {
                    const doc = getDocument();
                    const root = doc && doc.body ? doc.body : null;
                    const ghost = dragMulti.createMultiDragGhost({ count: keys.length, root });
                    if (ghost && typeof e.dataTransfer.setDragImage === 'function') {
                        try { e.dataTransfer.setDragImage(ghost, 12, 12); } catch (err) { /* ignore setDragImage failure */ }
                        runtime.activeDragGhost = ghost;
                    }
                }

                if (typeof setTimeoutFn === 'function') {
                    setTimeoutFn(() => {
                        if (selection.isMulti) {
                            const root = getShadowRoot();
                            if (root && typeof root.querySelector === 'function') {
                                keys.forEach((rowKey) => {
                                    const row = root.querySelector(`.source-item[data-source-key="${cssEscape(rowKey)}"]`);
                                    if (row && row.classList && typeof row.classList.add === 'function') {
                                        row.classList.add('dragging');
                                    }
                                });
                            } else if (sourceTarget.classList && typeof sourceTarget.classList.add === 'function') {
                                sourceTarget.classList.add('dragging');
                            }
                        } else if (sourceTarget.classList && typeof sourceTarget.classList.add === 'function') {
                            sourceTarget.classList.add('dragging');
                        }
                    }, 0);
                }
                return;
            }

            if (groupTarget) {
                const key = groupTarget.dataset.groupId;
                if (key) {
                    e.dataTransfer.setData('application/group-id', key);
                    runtime.activeDragContext = { kind: 'group', draggedGroupId: key };
                    e.dataTransfer.effectAllowed = 'move';
                    if (typeof setTimeoutFn === 'function') {
                        setTimeoutFn(() => groupTarget.classList.add('dragging'), 0);
                    }
                }
            }
        }

        function handleDragOver(e) {
            e.preventDefault();
            const dropTarget = e.target.closest('.group-container, .source-item');
            if (dropTarget) {
                const rect = dropTarget.getBoundingClientRect();
                const offsetY = e.clientY - rect.top;

                dropTarget.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-into');

                if (dropTarget.classList.contains('group-container')) {
                    if (offsetY < rect.height * 0.25) dropTarget.classList.add('drag-over-top');
                    else if (offsetY > rect.height * 0.75) dropTarget.classList.add('drag-over-bottom');
                    else dropTarget.classList.add('drag-into');
                } else {
                    if (offsetY < rect.height / 2) dropTarget.classList.add('drag-over-top');
                    else dropTarget.classList.add('drag-over-bottom');
                }
            }

            if (autoScrollController && dragMulti && typeof dragMulti.computeAutoScrollVelocity === 'function') {
                const root = getShadowRoot();
                const list = root && typeof root.getElementById === 'function' ? root.getElementById('sources-list') : null;
                if (list && typeof list.getBoundingClientRect === 'function') {
                    const listRect = list.getBoundingClientRect();
                    const velocity = dragMulti.computeAutoScrollVelocity({
                        pointerY: e.clientY,
                        containerTop: listRect.top,
                        containerBottom: listRect.bottom,
                        edgePx: dragMulti.EDGE_PX,
                        maxSpeed: dragMulti.MAX_SPEED
                    });
                    autoScrollController.tick(velocity);
                }
            }
        }

        function handleDragLeave(e) {
            const dropTarget = e.target.closest('.group-container, .source-item');
            if (dropTarget) {
                dropTarget.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-into');
            }
            if (e.target && e.target.id === 'sources-list' && autoScrollController) {
                autoScrollController.stop();
            }
        }

        function clearDragFeedback(root = getShadowRoot()) {
            let count = 0;
            if (root && typeof root.querySelectorAll === 'function') {
                const nodes = Array.from(root.querySelectorAll('.dragging, .drag-over-top, .drag-over-bottom, .drag-into'));
                nodes.forEach((node) => {
                    if (node?.classList && typeof node.classList.remove === 'function') {
                        node.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom', 'drag-into');
                    }
                });
                count = nodes.length;
            }
            if (autoScrollController) autoScrollController.stop();
            runtime.activeDragContext = null;
            return count;
        }

        function getSourceTreePosition(sourceKey) {
            const state = getState();
            const parentGroup = findParentGroupOfSource(sourceKey);
            if (parentGroup) {
                return {
                    list: parentGroup.children,
                    index: parentGroup.children.findIndex((child) => child.type === 'source' && child.key === sourceKey),
                    parentGroup
                };
            }

            state.ungrouped = Array.isArray(state.ungrouped) ? state.ungrouped : [];
            return {
                list: state.ungrouped,
                index: state.ungrouped.indexOf(sourceKey),
                parentGroup: null
            };
        }

        function getGroupTreePosition(groupId) {
            const state = getState();
            const groupsById = getGroupsById();
            const parentId = getParentMap().get(groupId);
            if (parentId) {
                const parentGroup = groupsById.get(parentId);
                return {
                    list: parentGroup?.children || [],
                    index: parentGroup?.children?.findIndex((child) => child.type === 'group' && child.id === groupId) ?? -1,
                    parentGroup: parentGroup || null
                };
            }

            state.groups = Array.isArray(state.groups) ? state.groups : [];
            return {
                list: state.groups,
                index: state.groups.indexOf(groupId),
                parentGroup: null
            };
        }

        function getNormalizedInsertionIndex(targetList, insertIndex, originalPosition = null) {
            const list = Array.isArray(targetList) ? targetList : [];
            let nextIndex = Number.isInteger(insertIndex) && insertIndex >= 0 ? insertIndex : list.length;
            if (originalPosition && originalPosition.list === list && nextIndex > originalPosition.index) {
                nextIndex -= 1;
            }
            const maxIndex = originalPosition && originalPosition.list === list
                ? Math.max(0, list.length - 1)
                : list.length;
            return Math.max(0, Math.min(nextIndex, maxIndex));
        }

        function isNoopTreeMove(originalPosition, targetList, insertIndex) {
            if (!originalPosition || originalPosition.index < 0) return true;
            const nextIndex = getNormalizedInsertionIndex(targetList, insertIndex, originalPosition);
            return originalPosition.list === targetList && originalPosition.index === nextIndex;
        }

        function getDropIntent(dropTarget, isInto, isAbove) {
            const state = getState();
            const groupsById = getGroupsById();
            const parentMap = getParentMap();

            if (dropTarget.classList.contains('group-container')) {
                const targetGroupId = dropTarget.dataset.groupId;
                const targetGroup = groupsById.get(targetGroupId);
                if (!targetGroup) return null;

                if (isInto) {
                    return {
                        targetGroup,
                        targetList: targetGroup.children,
                        insertIndex: -1
                    };
                }

                const parentId = parentMap.get(targetGroupId);
                if (parentId) {
                    const parentGroup = groupsById.get(parentId);
                    if (!parentGroup) return null;
                    let insertIndex = parentGroup.children.findIndex((child) => child.type === 'group' && child.id === targetGroupId);
                    if (!isAbove && insertIndex !== -1) insertIndex += 1;
                    return {
                        targetGroup: parentGroup,
                        targetList: parentGroup.children,
                        insertIndex
                    };
                }

                state.groups = Array.isArray(state.groups) ? state.groups : [];
                let insertIndex = state.groups.indexOf(targetGroupId);
                if (!isAbove && insertIndex !== -1) insertIndex += 1;
                return {
                    targetGroup: null,
                    targetList: state.groups,
                    insertIndex
                };
            }

            if (dropTarget.classList.contains('source-item')) {
                const targetSourceKey = dropTarget.dataset.sourceKey;
                const targetGroup = findParentGroupOfSource(targetSourceKey);
                const targetList = targetGroup
                    ? targetGroup.children
                    : (state.ungrouped = Array.isArray(state.ungrouped) ? state.ungrouped : []);
                let insertIndex = targetGroup
                    ? targetGroup.children.findIndex((child) => child.type === 'source' && child.key === targetSourceKey)
                    : targetList.indexOf(targetSourceKey);
                if (!isAbove && insertIndex !== -1) insertIndex += 1;
                return {
                    targetGroup,
                    targetList,
                    insertIndex
                };
            }

            return null;
        }

        function normalizeIntentKind(isInto, isAbove, dropTarget) {
            if (isInto && dropTarget.classList.contains('group-container')) return 'into-group';
            if (dropTarget.classList.contains('group-container')) return isAbove ? 'before-group' : 'after-group';
            return isAbove ? 'before-source' : 'after-source';
        }

        function handleDrop(e) {
            const state = getState();
            const groupsById = getGroupsById();
            const sourcesByKey = getSourcesByKey();
            const pendingBatchKeys = getPendingBatchKeys();
            const dropTarget = e.target.closest('.group-container, .source-item');
            if (!dropTarget) {
                clearDragFeedback();
                return;
            }
            e.preventDefault();

            const isInto = dropTarget.classList.contains('drag-into');
            const isAbove = dropTarget.classList.contains('drag-over-top');
            const intentKind = normalizeIntentKind(isInto, isAbove, dropTarget);
            const intent = getDropIntent(dropTarget, isInto, isAbove);
            clearDragFeedback();

            const sourceKey = e.dataTransfer.getData('application/source-key');
            const sourceKeysRaw = e.dataTransfer.getData('application/source-keys');
            const draggedGroupId = e.dataTransfer.getData('application/group-id');
            if (!intent) return;

            if (sourceKeysRaw && dragMulti && typeof dragMulti.applyMultiSourceDrop === 'function') {
                let keys = null;
                try { keys = JSON.parse(sourceKeysRaw); } catch (err) { keys = null; }
                if (Array.isArray(keys) && keys.length >= 2) {
                    const allowedMultiIntents = new Set(['into-group', 'before-source', 'after-source']);
                    if (!allowedMultiIntents.has(intentKind)) {
                        clearDragFeedback();
                        return;
                    }
                    const augmentedIntent = {
                        kind: intentKind,
                        targetList: intent.targetList,
                        insertIndex: intent.insertIndex,
                        targetGroupId: intent.targetGroup ? intent.targetGroup.id : null
                    };
                    const result = dragMulti.applyMultiSourceDrop({
                        keys,
                        intent: augmentedIntent,
                        state,
                        helpers: {
                            sourceExists: (key) => sourcesByKey.has(key),
                            getGroupById: (id) => groupsById.get(id) || null,
                            removeSourceFromParent: (key) => removeSourceFromTree(key)
                        }
                    });
                    if (result && result.moved > 0) {
                        developerLog('info', 'source_action', 'batch_drag_move', { count: result.moved, intent: intentKind });
                        state.isBatchMode = false;
                        pendingBatchKeys.clear();
                        buildParentMap();
                        saveState({ immediate: true, critical: true });
                        render();
                        showToast(getMessage('ui_batch_moved_sources_toast', [String(result.moved)]));
                    }
                    clearDragFeedback();
                    return;
                }
            }

            let didMove = false;

            if (sourceKey) {
                const originalPosition = getSourceTreePosition(sourceKey);
                if (isNoopTreeMove(originalPosition, intent.targetList, intent.insertIndex)) {
                    return;
                }
                const insertionIndex = getNormalizedInsertionIndex(intent.targetList, intent.insertIndex, originalPosition);
                removeSourceFromTree(sourceKey);
                if (intent.targetGroup) {
                    intent.targetGroup.children.splice(insertionIndex, 0, { type: 'source', key: sourceKey });
                } else {
                    state.ungrouped.splice(insertionIndex, 0, sourceKey);
                }
                didMove = true;
            } else if (draggedGroupId) {
                const draggedGroupObj = groupsById.get(draggedGroupId);
                if (!draggedGroupObj) return;
                if (intent.targetGroup && isDescendant(intent.targetGroup, draggedGroupObj, groupsById)) {
                    return;
                }
                const originalPosition = getGroupTreePosition(draggedGroupId);
                if (isNoopTreeMove(originalPosition, intent.targetList, intent.insertIndex)) {
                    return;
                }
                const insertionIndex = getNormalizedInsertionIndex(intent.targetList, intent.insertIndex, originalPosition);
                removeGroupFromTree(draggedGroupId);
                if (intent.targetGroup) {
                    intent.targetGroup.children.splice(insertionIndex, 0, { type: 'group', id: draggedGroupId });
                } else {
                    state.groups.splice(insertionIndex, 0, draggedGroupId);
                }
                didMove = true;
            }

            if (!didMove) return;
            buildParentMap();
            render();
            saveState({ immediate: true, critical: true });
        }

        function handleDragEnd(e) {
            clearDragFeedback();
            if (autoScrollController) autoScrollController.stop();
            if (runtime.activeDragGhost && dragMulti && typeof dragMulti.destroyMultiDragGhost === 'function') {
                const ghost = runtime.activeDragGhost;
                runtime.activeDragGhost = null;
                const raf = typeof globalThis.requestAnimationFrame === 'function' ? globalThis.requestAnimationFrame : null;
                if (raf) {
                    raf(() => dragMulti.destroyMultiDragGhost(ghost));
                } else {
                    dragMulti.destroyMultiDragGhost(ghost);
                }
            }
            runtime.activeDragContext = null;
        }

        return {
            handleAddNewGroup,
            syncSourceToPage,
            processClickQueue,
            findParentGroupOfSource,
            removeSourceFromTree,
            isBatchOperableSource,
            collectSourceKeysInTreeOrder,
            executeBatchMoveToUngrouped,
            canMoveSourceToUngrouped,
            moveSourceToUngrouped,
            removeGroupFromTree,
            toggleGroupCollapse,
            handleInteraction,
            handleOriginalCheckboxChange,
            triggerRename,
            handleDragStart,
            handleDragOver,
            handleDragLeave,
            handleDrop,
            handleDragEnd,
            clearDragFeedback,
            getDropIntent,
            getSourceTreePosition,
            getGroupTreePosition,
            isNoopTreeMove
        };
    }

    globalThis.NSM_CREATE_CONTENT_TREE_INTERACTIONS = createContentTreeInteractions;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentTreeInteractions;
    }
}());
