(function () {
    'use strict';

    function createContentRender(deps = {}) {
        const getDocument = typeof deps.getDocument === 'function'
            ? deps.getDocument
            : () => (typeof document !== 'undefined' ? document : null);
        const getShadowRoot = typeof deps.getShadowRoot === 'function'
            ? deps.getShadowRoot
            : () => (deps.shadowRoot || null);
        const getState = typeof deps.getState === 'function'
            ? deps.getState
            : () => (deps.state || {});
        const getGroupsById = typeof deps.getGroupsById === 'function'
            ? deps.getGroupsById
            : () => (deps.groupsById || new Map());
        const getTagsById = typeof deps.getTagsById === 'function'
            ? deps.getTagsById
            : () => (deps.tagsById || new Map());
        const getSourcesByKey = typeof deps.getSourcesByKey === 'function'
            ? deps.getSourcesByKey
            : () => (deps.sourcesByKey || new Map());
        const getPendingBatchKeys = typeof deps.getPendingBatchKeys === 'function'
            ? deps.getPendingBatchKeys
            : () => (deps.pendingBatchKeys || new Set());
        const getActiveIsolationGroupId = typeof deps.getActiveIsolationGroupId === 'function'
            ? deps.getActiveIsolationGroupId
            : () => (deps.activeIsolationGroupId || null);
        const getIsDeletingSources = typeof deps.getIsDeletingSources === 'function'
            ? deps.getIsDeletingSources
            : () => Boolean(deps.isDeletingSources);
        const getMessage = typeof deps.getMessage === 'function'
            ? deps.getMessage
            : (key) => key;
        const el = typeof deps.el === 'function'
            ? deps.el
            : (typeof globalThis.el === 'function' ? globalThis.el : null);
        const syncSearchUi = typeof deps.syncSearchUi === 'function'
            ? deps.syncSearchUi
            : () => {};
        const hasActiveRenderFilters = typeof deps.hasActiveRenderFilters === 'function'
            ? deps.hasActiveRenderFilters
            : () => false;
        const sourceMatchesCurrentFilters = typeof deps.sourceMatchesCurrentFilters === 'function'
            ? deps.sourceMatchesCurrentFilters
            : () => true;
        const areAllAncestorsEnabled = typeof deps.areAllAncestorsEnabled === 'function'
            ? deps.areAllAncestorsEnabled
            : () => true;
        const isSourceWithinActiveIsolation = typeof deps.isSourceWithinActiveIsolation === 'function'
            ? deps.isSourceWithinActiveIsolation
            : () => true;
        const isGroupWithinActiveIsolation = typeof deps.isGroupWithinActiveIsolation === 'function'
            ? deps.isGroupWithinActiveIsolation
            : () => true;
        const isSourceEffectivelyEnabled = typeof deps.isSourceEffectivelyEnabled === 'function'
            ? deps.isSourceEffectivelyEnabled
            : () => true;
        const shouldRenderGroup = typeof deps.shouldRenderGroup === 'function'
            ? deps.shouldRenderGroup
            : () => true;
        const getSourceTagIds = typeof deps.getSourceTagIds === 'function'
            ? deps.getSourceTagIds
            : () => [];
        const getTagStyleVars = typeof deps.getTagStyleVars === 'function'
            ? deps.getTagStyleVars
            : () => '';
        const handleInteraction = typeof deps.handleInteraction === 'function'
            ? deps.handleInteraction
            : () => {};
        const canOpenSourceActionMenu = typeof deps.canOpenSourceActionMenu === 'function'
            ? deps.canOpenSourceActionMenu
            : () => false;
        const findSourceActionButton = typeof deps.findSourceActionButton === 'function'
            ? deps.findSourceActionButton
            : () => null;
        const getSourceActionMenuItems = typeof deps.getSourceActionMenuItems === 'function'
            ? deps.getSourceActionMenuItems
            : () => [];
        const getSourceActionSubmenuItems = typeof deps.getSourceActionSubmenuItems === 'function'
            ? deps.getSourceActionSubmenuItems
            : () => [];
        const getSourceActionMenuPosition = typeof deps.getSourceActionMenuPosition === 'function'
            ? deps.getSourceActionMenuPosition
            : () => null;
        const getSourceActionSubmenuPosition = typeof deps.getSourceActionSubmenuPosition === 'function'
            ? deps.getSourceActionSubmenuPosition
            : () => null;
        const syncActiveSourceActionMenuState = typeof deps.syncActiveSourceActionMenuState === 'function'
            ? deps.syncActiveSourceActionMenuState
            : () => false;
        const getActiveSourceActionSourceKey = typeof deps.getActiveSourceActionSourceKey === 'function'
            ? deps.getActiveSourceActionSourceKey
            : () => null;
        const getActiveSourceActionSubmenuAction = typeof deps.getActiveSourceActionSubmenuAction === 'function'
            ? deps.getActiveSourceActionSubmenuAction
            : () => null;
        const getSourceActionMenuPositionState = typeof deps.getSourceActionMenuPositionState === 'function'
            ? deps.getSourceActionMenuPositionState
            : () => null;
        const setSourceActionMenuPosition = typeof deps.setSourceActionMenuPosition === 'function'
            ? deps.setSourceActionMenuPosition
            : () => {};

        function getGroupEffectiveState(group) {
            const groupsById = getGroupsById();
            const descendantKeys = [];
            const getKeys = (g) => {
                if (!g) return;
                g.children.forEach((child) => {
                    if (child.type === 'source') descendantKeys.push(child.key);
                    else getKeys(groupsById.get(child.id));
                });
            };
            getKeys(group);

            const total = descendantKeys.length;
            const on = descendantKeys.filter((key) => {
                return isSourceEffectivelyEnabled(getSourcesByKey().get(key));
            }).length;

            return { on, total };
        }

        function patchNode(target, source) {
            if (target.nodeType !== source.nodeType) {
                target.parentNode.replaceChild(source.cloneNode(true), target);
                return;
            }
            if (target.nodeType === Node.TEXT_NODE) {
                if (target.textContent !== source.textContent) {
                    target.textContent = source.textContent;
                }
                return;
            }
            if (target.nodeName !== source.nodeName) {
                target.parentNode.replaceChild(source.cloneNode(true), target);
                return;
            }

            const targetAttrs = target.attributes;
            const sourceAttrs = source.attributes;
            for (let i = targetAttrs.length - 1; i >= 0; i--) {
                const name = targetAttrs[i].name;
                if (!source.hasAttribute(name)) {
                    target.removeAttribute(name);
                }
            }
            for (let i = 0; i < sourceAttrs.length; i++) {
                const name = sourceAttrs[i].name;
                const value = sourceAttrs[i].value;
                if (target.getAttribute(name) !== value) {
                    target.setAttribute(name, value);
                }
            }

            if (target.tagName === 'INPUT') {
                if (target.checked !== source.checked) target.checked = source.checked;
                if (target.value !== source.value) target.value = source.value;
                if (target.disabled !== source.disabled) target.disabled = source.disabled;
            }

            const targetChildren = Array.from(target.childNodes);
            const sourceChildren = Array.from(source.childNodes);
            const maxLength = Math.max(targetChildren.length, sourceChildren.length);

            for (let i = 0; i < maxLength; i++) {
                if (i >= targetChildren.length) {
                    target.appendChild(sourceChildren[i].cloneNode(true));
                } else if (i >= sourceChildren.length) {
                    target.removeChild(targetChildren[i]);
                } else {
                    patchNode(targetChildren[i], sourceChildren[i]);
                }
            }
        }

        function patchChildren(target, sourceFragment) {
            const targetChildren = Array.from(target.childNodes);
            const sourceChildren = Array.from(sourceFragment.childNodes);
            const maxLength = Math.max(targetChildren.length, sourceChildren.length);

            for (let i = 0; i < maxLength; i++) {
                if (i >= targetChildren.length) {
                    target.appendChild(sourceChildren[i].cloneNode(true));
                } else if (i >= sourceChildren.length) {
                    target.removeChild(targetChildren[i]);
                } else {
                    patchNode(targetChildren[i], sourceChildren[i]);
                }
            }
        }

        function renderViewStateBar() {
            const shadowRoot = getShadowRoot();
            if (!shadowRoot) return;
            const container = shadowRoot.getElementById('sp-view-state');
            if (!container) return;

            const doc = getDocument();
            const fragment = doc ? doc.createDocumentFragment() : null;
            if (!fragment) return;
            const groupsById = getGroupsById();
            const state = getState() || {};
            const isolatedGroup = getActiveIsolationGroupId() ? groupsById.get(getActiveIsolationGroupId()) : null;
            const activeTag = state.activeTagId ? getTagsById().get(state.activeTagId) : null;

            if (isolatedGroup) {
                fragment.appendChild(el('div', { className: 'sp-view-banner' }, [
                    el('div', { className: 'sp-view-banner-copy' }, [
                        el('span', { className: 'sp-view-banner-label' }, [getMessage('ui_isolation_active', [isolatedGroup.title])])
                    ]),
                    el('button', { className: 'sp-button sp-view-banner-btn', id: 'sp-clear-isolate-btn' }, [getMessage('ui_exit_isolate')])
                ]));
            }

            if (activeTag) {
                fragment.appendChild(el('div', { className: 'sp-view-banner' }, [
                    el('div', { className: 'sp-view-banner-copy' }, [
                        el('span', { className: 'sp-view-banner-label' }, [getMessage('ui_tag_filter_active', [activeTag.label])])
                    ]),
                    el('button', { className: 'sp-button sp-view-banner-btn', id: 'sp-clear-tag-filter-btn' }, [getMessage('ui_clear_tag_filter')])
                ]));
            }

            container.hidden = fragment.childNodes.length === 0;
            patchChildren(container, fragment);
        }

        function getSourceActionMenuLayer() {
            const shadowRoot = getShadowRoot();
            if (!shadowRoot) return null;

            let layer = shadowRoot.getElementById('sp-source-actions-layer');
            if (layer) return layer;

            const doc = getDocument();
            if (!doc) return null;
            layer = doc.createElement('div');
            layer.id = 'sp-source-actions-layer';
            layer.className = 'sp-source-actions-layer';
            if (typeof handleInteraction === 'function') {
                layer.addEventListener('click', handleInteraction);
            }
            shadowRoot.appendChild(layer);
            return layer;
        }

        function renderSourceActionMenuLayer() {
            const layer = getSourceActionMenuLayer();
            if (
                !layer ||
                !layer.childNodes ||
                typeof layer.appendChild !== 'function' ||
                typeof layer.removeChild !== 'function'
            ) {
                return;
            }

            const doc = getDocument();
            if (!doc) return;

            const fragment = doc.createDocumentFragment();
            const sourceKey = getActiveSourceActionSourceKey();
            const source = sourceKey ? getSourcesByKey().get(sourceKey) : null;

            const menuItems = getSourceActionMenuItems(sourceKey);
            const submenuAction = getActiveSourceActionSubmenuAction();
            const submenuItems = getSourceActionSubmenuItems(sourceKey, submenuAction);
            const submenuParentIndex = menuItems.findIndex((item) => item.action === submenuAction);
            const menuPosition = getSourceActionMenuPositionState();

            if (sourceKey && source && canOpenSourceActionMenu(source)) {
                const actionButton = findSourceActionButton(sourceKey);
                setSourceActionMenuPosition(getSourceActionMenuPosition(actionButton, menuItems.length));
            }

            const activeMenuPosition = getSourceActionMenuPositionState() || menuPosition;
            if (sourceKey && source && activeMenuPosition && canOpenSourceActionMenu(source)) {
                fragment.appendChild(el('div', {
                    className: 'sp-source-actions-menu' + (activeMenuPosition.placement === 'top' ? ' is-top' : ''),
                    role: 'menu',
                    'aria-label': getMessage('ui_source_actions'),
                    style: `top:${Math.round(activeMenuPosition.top)}px;left:${Math.round(activeMenuPosition.left)}px;`
                }, menuItems.map((item) => (
                    el('button', {
                        type: 'button',
                        className: 'sp-source-actions-menu-item' +
                            (item.kind === 'submenu' ? ' is-parent' : '') +
                            (submenuAction === item.action ? ' is-expanded' : ''),
                        dataset: { sourceKey, action: item.action },
                        role: 'menuitem',
                        title: item.label,
                        'aria-label': item.label,
                        'aria-haspopup': item.kind === 'submenu' ? 'menu' : null,
                        'aria-expanded': item.kind === 'submenu'
                            ? (submenuAction === item.action ? 'true' : 'false')
                            : null
                    }, [
                        el('span', { className: 'sp-source-actions-menu-item-content' }, [
                            el('span', { className: 'google-symbols' }, [item.icon]),
                            el('span', { className: 'sp-source-actions-menu-label' }, [item.label])
                        ]),
                        item.kind === 'submenu'
                            ? el('span', { className: 'google-symbols sp-source-actions-menu-chevron' }, ['chevron_right'])
                            : ''
                    ])
                ))));

                const submenuPosition = getSourceActionSubmenuPosition(
                    activeMenuPosition,
                    submenuParentIndex,
                    submenuItems.length
                );
                if (submenuItems.length > 0 && submenuPosition) {
                    fragment.appendChild(el('div', {
                        className: 'sp-source-actions-menu sp-source-actions-submenu' +
                            (submenuPosition.horizontalPlacement === 'left' ? ' is-left' : ''),
                        role: 'menu',
                        'aria-label': getMessage('ui_view_source'),
                        style: `top:${Math.round(submenuPosition.top)}px;left:${Math.round(submenuPosition.left)}px;`
                    }, submenuItems.map((item) => (
                        el('button', {
                            type: 'button',
                            className: 'sp-source-actions-menu-item',
                            dataset: { sourceKey, action: item.action },
                            role: 'menuitem',
                            title: item.label,
                            'aria-label': item.label
                        }, [
                            el('span', { className: 'sp-source-actions-menu-item-content' }, [
                                el('span', { className: 'google-symbols' }, [item.icon]),
                                el('span', { className: 'sp-source-actions-menu-label' }, [item.label])
                            ])
                        ])
                    ))));
                }
            }

            patchChildren(layer, fragment);
        }

        function createSourceGlyphIcon(iconName, iconColorClass) {
            return el('mat-icon', { className: `${iconColorClass || 'icon-color'} mat-icon google-symbols` }, [iconName]);
        }

        function createGroupTitleIconElement() {
            return el('span', { className: 'sp-group-title-icon', 'aria-hidden': 'true' }, [
                el('span', { className: 'google-symbols' }, ['folder'])
            ]);
        }

        function replaceSourceIconWithFallback(imageElement, source) {
            if (!imageElement || imageElement.__spFallbackApplied) return;
            imageElement.__spFallbackApplied = true;

            const parent = imageElement.parentNode;
            if (!parent) return;

            const fallbackIcon = createSourceGlyphIcon(source.iconName, source.iconColorClass);
            if (typeof parent.replaceChildren === 'function') {
                parent.replaceChildren(fallbackIcon);
                return;
            }

            if (Array.isArray(parent.childNodes)) {
                parent.childNodes.length = 0;
            }
            if (Array.isArray(parent.children)) {
                parent.children.length = 0;
            }
            if (typeof parent.appendChild === 'function') {
                parent.appendChild(fallbackIcon);
            }
        }

        function createSourceIconElement(source, isFailed = false) {
            if (source?.isLoading) {
                return el('div', { className: 'sp-spinner' });
            }

            if (isFailed) {
                return createSourceGlyphIcon('error', source?.iconColorClass);
            }

            if (!source?.iconImageUrl) {
                return createSourceGlyphIcon(source?.iconName || 'article', source?.iconColorClass);
            }

            const imageEl = el('img', {
                className: 'source-icon-image',
                src: source.iconImageUrl,
                alt: '',
                draggable: 'false',
                referrerpolicy: 'no-referrer'
            });
            if (typeof imageEl.addEventListener === 'function') {
                imageEl.addEventListener('error', () => replaceSourceIconWithFallback(imageEl, source));
            }
            return imageEl;
        }

        function render() {
            const shadowRoot = getShadowRoot();
            if (!shadowRoot) return;
            const listContainer = shadowRoot.querySelector('#sources-list');
            if (!listContainer) return;

            syncActiveSourceActionMenuState();
            syncSearchUi();
            renderViewStateBar();

            const doc = getDocument();
            if (!doc) return;
            const fragment = doc.createDocumentFragment();
            const state = getState() || {};
            const activeFilters = hasActiveRenderFilters();
            const groupsById = getGroupsById();
            const sourcesByKey = getSourcesByKey();
            const tagsById = getTagsById();
            const pendingBatchKeys = getPendingBatchKeys();
            const activeIsolationGroupId = getActiveIsolationGroupId();

            const renderSourceItem = (source) => {
                if (!source || !sourceMatchesCurrentFilters(source)) return null;
                const isGated = !areAllAncestorsEnabled(source.key) || !isSourceWithinActiveIsolation(source.key);
                const isFailed = source.isDisabled && !source.isLoading;
                const isLoading = source.isLoading;
                const showSourceActionButton = !state.isBatchMode;
                const canOpenActions = canOpenSourceActionMenu(source);
                const isSourceActionMenuOpen = canOpenActions && getActiveSourceActionSourceKey() === source.key;
                const orderedSourceTags = getSourceTagIds(source.key)
                    .map((tagId) => tagsById.get(tagId))
                    .filter(Boolean);

                let extraClasses = '';
                if (isGated) extraClasses += ' gated';
                if (isFailed) extraClasses += ' failed-source';
                if (isLoading) extraClasses += ' loading-source';
                if (state.isBatchMode && pendingBatchKeys.has(source.key)) extraClasses += ' selected-for-batch';

                let titleAttr = false;
                if (isFailed) titleAttr = getMessage('ui_source_import_failed');
                if (isLoading) titleAttr = getMessage('ui_source_parsing');

                return el('div', {
                    className: 'source-item' + extraClasses,
                    draggable: !state.isBatchMode && !isFailed && !isLoading ? 'true' : 'false',
                    dataset: { sourceKey: source.key },
                    title: titleAttr
                }, [
                    el('div', { className: 'icon-container' }, [
                        createSourceIconElement(source, isFailed)
                    ]),
                    showSourceActionButton ? el('div', {
                        className: 'sp-source-actions-anchor' + (isSourceActionMenuOpen ? ' is-open' : '')
                    }, [
                        el('button', {
                            type: 'button',
                            className: 'sp-source-actions-button',
                            dataset: { sourceKey: source.key },
                            title: getMessage('ui_source_actions'),
                            'aria-label': getMessage('ui_source_actions'),
                            'aria-haspopup': 'menu',
                            'aria-expanded': isSourceActionMenuOpen ? 'true' : 'false',
                            disabled: !canOpenActions
                        }, [
                            el('span', { className: 'google-symbols' }, ['more_horiz'])
                        ])
                    ]) : '',
                    el('div', { className: 'title-container' }, [
                        el('div', { className: 'source-title-text' }, [source.title]),
                        orderedSourceTags.length > 0 ? el('div', { className: 'source-tag-list' }, orderedSourceTags.map((tag) => (
                            el('button', {
                                className: 'sp-tag-pill' + (state.activeTagId === tag.id ? ' is-active' : ''),
                                dataset: { tagId: tag.id },
                                title: getMessage('ui_tag_filter_active', [tag.label]),
                                style: getTagStyleVars(tag, state.activeTagId === tag.id)
                            }, [tag.label])
                        ))) : ''
                    ]),
                    el('div', { className: 'checkbox-container' }, [
                        state.isBatchMode
                            ? el('input', {
                                type: 'checkbox',
                                className: 'sp-batch-checkbox sp-checkbox',
                                dataset: { sourceKey: source.key },
                                checked: pendingBatchKeys.has(source.key),
                                disabled: isFailed || isLoading
                            })
                            : el('input', {
                                type: 'checkbox',
                                className: 'sp-checkbox',
                                dataset: { sourceKey: source.key },
                                checked: source.enabled,
                                disabled: isFailed || isLoading
                            })
                    ])
                ]);
            };

            const renderGroup = (group, level) => {
                if (!shouldRenderGroup(group)) return null;

                const isGated = !group.enabled || !areAllAncestorsEnabled(group.id) || !isGroupWithinActiveIsolation(group.id);
                const { on, total } = getGroupEffectiveState(group);
                const groupTitle = group.title || getMessage('ui_group_untitled');
                const childrenElements = [];

                group.children.forEach((child) => {
                    if (child.type === 'source') {
                        const sourceElement = renderSourceItem(sourcesByKey.get(child.key));
                        if (sourceElement) childrenElements.push(sourceElement);
                        return;
                    }

                    const childGroup = groupsById.get(child.id);
                    if (!childGroup) return;
                    const childElement = renderGroup(childGroup, level + 1);
                    if (childElement) childrenElements.push(childElement);
                });

                if (childrenElements.length === 0 && !activeFilters) {
                    childrenElements.push(el('div', { className: 'sp-empty-state' }, [getMessage('ui_empty_group')]));
                }

                const groupEl = el('div', {
                    className: 'group-container' + (isGated ? ' gated' : '') + (group.isNewlyCreated ? ' sp-folder-enter' : ''),
                    dataset: { groupId: group.id },
                    style: `padding-left: ${level * 20}px`
                }, [
                    el('div', { className: 'group-header', draggable: !state.isBatchMode ? 'true' : 'false', dataset: { dragType: 'group', groupId: group.id } }, [
                        el('button', {
                            className: 'sp-caret' + (group.collapsed ? ' collapsed' : ''),
                            title: group.collapsed ? getMessage('ui_expand') : getMessage('ui_collapse')
                        }, [
                            el('span', { className: 'google-symbols' }, ['arrow_drop_down'])
                        ]),
                        !state.isBatchMode ? el('label', {
                            className: 'sp-toggle-switch',
                            title: group.enabled ? getMessage('ui_disable_group') : getMessage('ui_enable_group')
                        }, [
                            el('input', { type: 'checkbox', className: 'sp-group-toggle-checkbox', dataset: { groupId: group.id }, checked: group.enabled }),
                            el('span', { className: 'sp-toggle-slider' })
                        ]) : '',
                        createGroupTitleIconElement(),
                        el('span', { className: 'group-title' }, [groupTitle]),
                        el('span', { className: 'badge' }, [` ${on} / ${total} `]),
                        el('button', { className: 'sp-add-subgroup-button', title: getMessage('ui_add_subgroup') }, [el('span', { className: 'google-symbols' }, ['create_new_folder'])]),
                        el('button', {
                            className: 'sp-isolate-button' + (activeIsolationGroupId === group.id ? ' is-active' : ''),
                            title: getMessage('ui_isolate_group')
                        }, [el('span', { className: 'google-symbols' }, ['filter_center_focus'])]),
                        el('button', { className: 'sp-edit-button', title: getMessage('ui_rename') }, [el('span', { className: 'google-symbols' }, ['edit'])]),
                        el('button', { className: 'sp-delete-button', title: getMessage('ui_delete_group') }, [el('span', { className: 'google-symbols' }, ['delete'])])
                    ]),
                    el('div', { className: 'group-children' + (group.collapsed ? ' collapsed' : '') }, childrenElements)
                ]);

                if (group.isNewlyCreated) {
                    delete group.isNewlyCreated;
                }

                return groupEl;
            };

            const rootGroupIds = activeIsolationGroupId && groupsById.has(activeIsolationGroupId)
                ? [activeIsolationGroupId]
                : (Array.isArray(state.groups) ? state.groups : []);

            rootGroupIds.forEach((groupId) => {
                const group = groupsById.get(groupId);
                const groupElement = renderGroup(group, 0);
                if (groupElement) {
                    fragment.appendChild(groupElement);
                }
            });

            if (!activeIsolationGroupId) {
                const matchingUngrouped = (Array.isArray(state.ungrouped) ? state.ungrouped : []).filter((key) => {
                    const source = sourcesByKey.get(key);
                    return source && sourceMatchesCurrentFilters(source);
                });

                if (matchingUngrouped.length > 0) {
                    const ungroupedHeader = doc.createElement('h4');
                    ungroupedHeader.className = 'ungrouped-header';
                    ungroupedHeader.textContent = getMessage('ui_ungrouped');
                    fragment.appendChild(ungroupedHeader);

                    matchingUngrouped.forEach((key) => {
                        const sourceElement = renderSourceItem(sourcesByKey.get(key));
                        if (sourceElement) {
                            fragment.appendChild(sourceElement);
                        }
                    });
                }
            }

            if (fragment.childNodes.length === 0) {
                fragment.appendChild(el('div', { className: 'sp-empty-state' }, [getMessage('ui_no_matching_sources')]));
            }

            if (state.isBatchMode) {
                const actionBar = el('div', { className: 'sp-batch-action-bar' }, [
                    el('button', { className: 'sp-button sp-cancel-batch-btn' }, [getMessage('ui_cancel')]),
                    el('div', { className: 'sp-batch-actions' }, [
                        el('button', {
                            className: 'sp-button sp-batch-add-folder-btn',
                            disabled: pendingBatchKeys.size === 0 || getIsDeletingSources()
                        }, [getMessage('ui_batch_add_count', [pendingBatchKeys.size.toString()])]),
                        el('button', {
                            className: 'sp-button sp-confirm-delete-btn',
                            disabled: pendingBatchKeys.size === 0 || getIsDeletingSources()
                        }, [getIsDeletingSources() ? getMessage('ui_deleting') : getMessage('ui_delete_count', [pendingBatchKeys.size.toString()])])
                    ])
                ]);
                fragment.appendChild(actionBar);
            }

            patchChildren(listContainer, fragment);
            renderSourceActionMenuLayer();
        }

        return {
            getGroupEffectiveState,
            patchNode,
            patchChildren,
            renderViewStateBar,
            getSourceActionMenuLayer,
            renderSourceActionMenuLayer,
            createSourceGlyphIcon,
            createGroupTitleIconElement,
            replaceSourceIconWithFallback,
            createSourceIconElement,
            render
        };
    }

    globalThis.NSM_CREATE_CONTENT_RENDER = createContentRender;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentRender;
    }
})();
