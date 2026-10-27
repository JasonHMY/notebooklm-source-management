function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function defaultSourcesForNotebook(notebookId) {
    return [
        {
            id: `${notebookId}-source-a`,
            title: `Notebook ${notebookId} source A`,
            token: `${notebookId}-source-a`
        },
        {
            id: `${notebookId}-source-b`,
            title: `Notebook ${notebookId} source B`,
            token: `${notebookId}-source-b`
        }
    ];
}

function normalizeSources(notebookId, sources) {
    if (Array.isArray(sources) && sources.length > 0) {
        return sources.map((source, index) => ({
            id: source.id || `${notebookId}-source-${index + 1}`,
            title: source.title || `Notebook ${notebookId} source ${index + 1}`,
            token: source.token || source.id || `${notebookId}-source-${index + 1}`,
            iconUrl: source.iconUrl || ''
        }));
    }

    return defaultSourcesForNotebook(notebookId);
}

function renderNotebookHtml(notebookId, sources, options = {}) {
    const renderedSources = normalizeSources(notebookId, sources);
    const initialOptions = {
        stagedHydration: Boolean(options.stagedHydration),
        labelView: Boolean(options.labelView),
        labelViewWithoutRows: Boolean(options.labelViewWithoutRows),
        labelViewCollapsedGroups: Boolean(options.labelViewCollapsedGroups),
        labelViewMaterialGroups: Boolean(options.labelViewMaterialGroups),
        labelViewListSwitchNoop: Boolean(options.labelViewListSwitchNoop),
        ariaCheckboxes: Boolean(options.ariaCheckboxes)
    };

    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Notebook ${escapeHtml(notebookId)}</title>
    <style>
        html, body {
            margin: 0;
            min-height: 100%;
            font-family: Arial, sans-serif;
        }

        body {
            min-height: 100vh;
            background: #f6f7fb;
            color: #1f2937;
        }

        .app-shell {
            min-height: 100vh;
            padding: 24px;
            box-sizing: border-box;
        }

        [data-testid="source-panel"] {
            display: block;
            min-height: 260px;
            border: 1px solid #cfd6e4;
            border-radius: 12px;
            background: #fff;
            overflow: hidden;
        }

        .panel-header {
            display: flex;
            align-items: center;
            min-height: 56px;
            padding: 0 16px;
            font-weight: 700;
            border-bottom: 1px solid #e5e7eb;
            background: #ffffff;
        }

        [data-testid="scroll-area"] {
            display: block;
            padding: 12px 16px 20px;
        }

        [data-testid="native-source-utility-controls"] {
            display: block;
            padding: 12px 16px;
            border-bottom: 1px solid #e5e7eb;
        }

        [data-testid="native-add-source-button"],
        [data-testid="native-source-search"] {
            display: flex;
            align-items: center;
            gap: 8px;
            min-height: 36px;
            width: 100%;
            margin-bottom: 10px;
            padding: 8px 12px;
            border: 1px solid #d1d5db;
            border-radius: 10px;
            background: #ffffff;
            color: #374151;
            box-sizing: border-box;
        }

        mat-accordion {
            display: block;
            padding: 12px 16px;
        }

        mat-expansion-panel {
            display: block;
            margin-bottom: 10px;
            border: 1px solid #e5e7eb;
            border-radius: 12px;
            background: #fbfdff;
        }

        .mat-expansion-panel-header {
            display: flex;
            align-items: center;
            gap: 8px;
            width: 100%;
            min-height: 44px;
            padding: 8px 12px;
            border: 0;
            background: transparent;
            color: inherit;
            text-align: left;
        }

        [data-testid="source-item"] {
            display: block;
            margin-bottom: 10px;
        }

        .source-row-shell {
            display: flex;
            align-items: center;
            gap: 10px;
            min-height: 44px;
            padding: 8px 12px;
            border: 1px solid #e5e7eb;
            border-radius: 10px;
            background: #fbfdff;
        }

        .source-title {
            flex: 1;
        }
    </style>
    <script>
        (function () {
            const initialNotebookId = ${JSON.stringify(notebookId)};
            const initialSources = ${JSON.stringify(renderedSources)};
            const initialOptions = ${JSON.stringify(initialOptions)};
            let hydrationTimerIds = [];

            function clearHydrationTimers() {
                hydrationTimerIds.forEach((timerId) => window.clearTimeout(timerId));
                hydrationTimerIds = [];
            }

            function setHydrationPhase(nextPhase) {
                window.__fixtureHydrationState = nextPhase;
            }

            function scheduleHydrationPhase(callback, delayMs) {
                const timerId = window.setTimeout(() => {
                    hydrationTimerIds = hydrationTimerIds.filter((id) => id !== timerId);
                    callback();
                }, delayMs);
                hydrationTimerIds.push(timerId);
            }

            function createAriaCheckbox(label, checked = true) {
                const checkbox = document.createElement('div');
                checkbox.setAttribute('role', 'checkbox');
                checkbox.setAttribute('tabindex', '0');
                checkbox.setAttribute('aria-label', label);
                checkbox.setAttribute('aria-checked', checked ? 'true' : 'false');
                checkbox.className = 'native-aria-checkbox';
                checkbox.addEventListener('click', () => {
                    const nextState = checkbox.getAttribute('aria-checked') !== 'true';
                    checkbox.setAttribute('aria-checked', nextState ? 'true' : 'false');
                });
                return checkbox;
            }

            function createSourceItem(source, phase, options) {
                const wrapper = document.createElement('div');
                wrapper.className = 'single-source-container';
                wrapper.setAttribute('data-testid', 'source-item');
                wrapper.setAttribute('data-source-id', source.token);
                wrapper.setAttribute('role', 'button');

                const row = document.createElement('div');
                row.className = 'source-row-shell';

                const icon = document.createElement('mat-icon');
                icon.className = 'source-icon description-icon-color';
                icon.textContent = 'description';
                if (source.iconUrl) {
                    const imageIcon = document.createElement('img');
                    imageIcon.className = 'source-native-icon-image';
                    imageIcon.src = source.iconUrl;
                    imageIcon.alt = '';
                    row.appendChild(imageIcon);
                }

                const title = document.createElement('span');
                title.className = 'source-title';
                title.setAttribute('data-testid', 'source-title');
                title.textContent = source.title;

                row.appendChild(icon);
                row.appendChild(title);

                if (phase === 'full') {
                    const checkbox = options && options.ariaCheckboxes
                        ? createAriaCheckbox(source.title, source.enabled !== false)
                        : document.createElement('input');
                    if (!options || !options.ariaCheckboxes) {
                        checkbox.type = 'checkbox';
                        checkbox.setAttribute('aria-label', source.title);
                    }

                    const moreButton = document.createElement('button');
                    moreButton.type = 'button';
                    moreButton.setAttribute('aria-label', 'More options');

                    const moreIcon = document.createElement('mat-icon');
                    moreIcon.textContent = 'more_vert';
                    moreButton.appendChild(moreIcon);

                    row.appendChild(checkbox);
                    row.appendChild(moreButton);
                }

                wrapper.appendChild(row);

                return wrapper;
            }

            function renderSources(scrollArea, sources, phase, options) {
                scrollArea.replaceChildren();
                sources.forEach((source) => {
                    scrollArea.appendChild(createSourceItem(source, phase, options));
                });
            }

            function createNativeSourceUtilityControls() {
                const controls = document.createElement('div');
                controls.className = 'native-source-utility-controls';
                controls.setAttribute('data-testid', 'native-source-utility-controls');

                const addButton = document.createElement('button');
                addButton.type = 'button';
                addButton.setAttribute('data-testid', 'native-add-source-button');
                addButton.setAttribute('aria-label', 'Add source');
                addButton.textContent = '+ Add source';

                const searchBox = document.createElement('label');
                searchBox.setAttribute('data-testid', 'native-source-search');
                const searchIcon = document.createElement('span');
                searchIcon.textContent = 'search';
                const searchInput = document.createElement('input');
                searchInput.type = 'search';
                searchInput.setAttribute('aria-label', 'Search new sources on the web');
                searchInput.placeholder = 'Search new sources on the web';
                const searchButton = document.createElement('button');
                searchButton.type = 'button';
                searchButton.setAttribute('aria-label', 'Submit source search');
                searchButton.textContent = 'arrow_forward';
                searchBox.appendChild(searchIcon);
                searchBox.appendChild(searchInput);
                searchBox.appendChild(searchButton);

                controls.appendChild(addButton);
                controls.appendChild(searchBox);
                return controls;
            }

            function createLabelViewControls() {
                const controls = document.createElement('div');
                controls.className = 'source-label-controls';
                controls.setAttribute('aria-label', 'NotebookLM source label controls');

                const relabelButton = document.createElement('button');
                relabelButton.type = 'button';
                relabelButton.setAttribute('aria-label', 'Undo or relabel sources');
                relabelButton.textContent = 'label_auto';

                const selectAllLabel = document.createElement('label');
                selectAllLabel.textContent = 'Select all';
                const selectAll = document.createElement('input');
                selectAll.type = 'checkbox';
                selectAll.setAttribute('aria-label', 'Select all sources');
                selectAllLabel.appendChild(selectAll);

                controls.appendChild(relabelButton);
                controls.appendChild(selectAllLabel);
                return controls;
            }

            function createLabelGroup(labelTitle, sources, collapsed, options) {
                const group = document.createElement('section');
                group.className = 'source-label-group';
                group.setAttribute('data-testid', 'source-label-group');
                group.setAttribute('aria-label', labelTitle + ' label');
                group.setAttribute('data-label-title', labelTitle);

                const header = document.createElement('button');
                header.type = 'button';
                header.className = 'source-label-title';
                header.setAttribute('aria-label', labelTitle);
                header.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
                header.textContent = labelTitle;
                const checkbox = options && options.ariaCheckboxes
                    ? createAriaCheckbox(labelTitle, true)
                    : document.createElement('input');
                if (!options || !options.ariaCheckboxes) {
                    checkbox.type = 'checkbox';
                    checkbox.setAttribute('aria-label', labelTitle);
                }
                header.appendChild(checkbox);
                group.appendChild(header);

                let rowsRendered = false;
                const renderGroupRows = () => {
                    if (rowsRendered) return;
                    rowsRendered = true;
                    sources.forEach((source) => {
                        const item = createSourceItem(source, 'full', options);
                        item.setAttribute('data-source-label', labelTitle);
                        group.appendChild(item);
                    });
                };
                if (!collapsed) renderGroupRows();
                header.addEventListener('click', (event) => {
                    if (event.target === checkbox) return;
                    header.setAttribute('aria-expanded', 'true');
                    renderGroupRows();
                });

                return group;
            }

            function createMaterialLabelGroup(labelTitle, sources, collapsed, options) {
                const panel = document.createElement('mat-expansion-panel');
                panel.className = 'mat-expansion-panel';
                panel.setAttribute('aria-label', labelTitle + ' label');

                const header = document.createElement('button');
                header.type = 'button';
                header.className = 'mat-expansion-panel-header';
                header.setAttribute('aria-label', labelTitle);
                header.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
                header.textContent = labelTitle;
                const checkbox = options && options.ariaCheckboxes
                    ? createAriaCheckbox(labelTitle, true)
                    : document.createElement('input');
                if (!options || !options.ariaCheckboxes) {
                    checkbox.type = 'checkbox';
                    checkbox.setAttribute('aria-label', labelTitle);
                }
                header.appendChild(checkbox);
                panel.appendChild(header);

                let rowsRendered = false;
                const renderGroupRows = () => {
                    if (rowsRendered) return;
                    rowsRendered = true;
                    sources.forEach((source) => {
                        const item = createSourceItem(source, 'full', options);
                        item.setAttribute('data-source-label', labelTitle);
                        panel.appendChild(item);
                    });
                };
                if (!collapsed) renderGroupRows();
                header.addEventListener('click', (event) => {
                    if (event.target === checkbox) return;
                    header.setAttribute('aria-expanded', 'true');
                    renderGroupRows();
                });

                return panel;
            }

            function renderLabelView(sourcePanel, sources, options) {
                sourcePanel.appendChild(createLabelViewControls());
                const shouldRenderRows = !options.labelViewWithoutRows;
                const groupFactory = options.labelViewMaterialGroups ? createMaterialLabelGroup : createLabelGroup;
                const groupContainer = options.labelViewMaterialGroups ? document.createElement('mat-accordion') : sourcePanel;
                if (options.labelViewMaterialGroups) {
                    groupContainer.className = 'mat-accordion';
                    sourcePanel.appendChild(groupContainer);
                }
                groupContainer.appendChild(groupFactory('Research papers', shouldRenderRows ? sources.slice(0, 1) : [], Boolean(options.labelViewCollapsedGroups), options));
                groupContainer.appendChild(groupFactory('Reference material', shouldRenderRows ? sources.slice(1) : [], Boolean(options.labelViewCollapsedGroups), options));
                setHydrationPhase('full');
            }

            function createSourceViewToggle(notebookId, sources, options) {
                const controls = document.createElement('div');
                controls.className = 'source-view-toggle';

                const listButton = document.createElement('button');
                listButton.type = 'button';
                listButton.setAttribute('aria-label', 'List view');
                listButton.setAttribute('data-testid', 'source-view-list-button');
                listButton.setAttribute('aria-pressed', options.labelView ? 'false' : 'true');
                listButton.textContent = 'view_list';
                listButton.addEventListener('click', () => {
                    if (options.labelView && options.labelViewListSwitchNoop) {
                        listButton.setAttribute('aria-pressed', 'true');
                        return;
                    }
                    renderNotebook(notebookId, sources, Object.assign({}, options, {
                        labelView: false,
                        labelViewWithoutRows: false
                    }));
                });

                const labelButton = document.createElement('button');
                labelButton.type = 'button';
                labelButton.setAttribute('aria-label', '整理来源');
                labelButton.setAttribute('data-testid', 'source-view-label-button');
                labelButton.setAttribute('aria-pressed', options.labelView ? 'true' : 'false');
                const labelIcon = document.createElement('mat-icon');
                labelIcon.setAttribute('data-mat-icon-name', 'label_auto');
                labelIcon.setAttribute('fonticon', 'label_auto');
                labelIcon.textContent = '';
                labelButton.appendChild(labelIcon);
                labelButton.addEventListener('click', () => {
                    renderNotebook(notebookId, sources, Object.assign({}, options, {
                        labelView: true,
                        labelViewWithoutRows: false
                    }));
                });

                controls.appendChild(listButton);
                controls.appendChild(labelButton);
                return controls;
            }

            function hydrateSources(scrollArea, sources, options) {
                clearHydrationTimers();
                if (!options || !options.stagedHydration) {
                    renderSources(scrollArea, sources, 'full', options);
                    setHydrationPhase('full');
                    return;
                }

                setHydrationPhase('empty');
                renderSources(scrollArea, [], 'full', options);
                scheduleHydrationPhase(() => {
                    renderSources(scrollArea, sources, 'partial', options);
                    setHydrationPhase('partial');
                }, 40);
                scheduleHydrationPhase(() => {
                    renderSources(scrollArea, sources, 'full', options);
                    setHydrationPhase('full');
                }, 120);
            }

            function renderNotebook(nextNotebookId, nextSources, nextOptions) {
                const sources = Array.isArray(nextSources) && nextSources.length > 0 ? nextSources : initialSources;
                const options = Object.assign({}, initialOptions, nextOptions || {});
                const title = nextNotebookId ? 'Notebook ' + nextNotebookId : 'Notebook';

                document.title = title;
                document.body.innerHTML = '';

                const appShell = document.createElement('main');
                appShell.className = 'app-shell';

                const sourcePanel = document.createElement('section');
                sourcePanel.className = 'source-panel';
                sourcePanel.setAttribute('data-testid', 'source-panel');

                const header = document.createElement('header');
                header.className = 'panel-header';
                const headerTitle = document.createElement('span');
                headerTitle.textContent = 'Sources for ' + title;
                header.appendChild(headerTitle);
                header.appendChild(createSourceViewToggle(nextNotebookId, sources, options));

                const scrollArea = document.createElement('div');
                scrollArea.className = 'scroll-area';
                scrollArea.setAttribute('data-testid', 'scroll-area');

                sourcePanel.appendChild(header);
                sourcePanel.appendChild(createNativeSourceUtilityControls());
                if (options.labelView) {
                    renderLabelView(sourcePanel, sources, options);
                } else {
                    sourcePanel.appendChild(scrollArea);
                }
                appShell.appendChild(sourcePanel);
                document.body.appendChild(appShell);

                if (!options.labelView) {
                    hydrateSources(scrollArea, sources, options);
                }
            }

            window.__swapNotebook = function swapNotebook(nextNotebook) {
                const notebookId = nextNotebook && nextNotebook.notebookId ? String(nextNotebook.notebookId) : initialNotebookId;
                const sources = nextNotebook && Array.isArray(nextNotebook.sources) ? nextNotebook.sources : initialSources;
                const options = nextNotebook && typeof nextNotebook === 'object'
                    ? {
                        stagedHydration: Boolean(nextNotebook.stagedHydration),
                        labelView: Boolean(nextNotebook.labelView),
                        labelViewWithoutRows: Boolean(nextNotebook.labelViewWithoutRows),
                        labelViewMaterialGroups: Boolean(nextNotebook.labelViewMaterialGroups),
                        labelViewListSwitchNoop: Boolean(nextNotebook.labelViewListSwitchNoop),
                        ariaCheckboxes: Boolean(nextNotebook.ariaCheckboxes)
                    }
                    : initialOptions;
                history.pushState({}, '', '/notebook/' + encodeURIComponent(notebookId));
                renderNotebook(notebookId, sources, options);
                return { notebookId, sourceCount: Array.isArray(sources) ? sources.length : 0 };
            };

            window.__replaceNotebookSources = function replaceNotebookSources(nextSources) {
                const scrollArea = document.querySelector('[data-testid="scroll-area"]');
                if (!scrollArea) {
                    return { success: false, sourceCount: 0 };
                }
                const sources = Array.isArray(nextSources) ? nextSources : initialSources;
                hydrateSources(scrollArea, sources, Object.assign({}, initialOptions, {
                    stagedHydration: false,
                    labelView: false
                }));
                return {
                    success: true,
                    sourceCount: sources.length
                };
            };

            window.__getNotebookId = function () {
                return document.title.replace(/^Notebook\\s+/, '');
            };

            window.__waitForFixtureHydration = function waitForFixtureHydration(targetPhase) {
                const desiredPhase = targetPhase || 'full';
                const phaseOrder = { empty: 0, partial: 1, full: 2 };
                return new Promise((resolve) => {
                    const check = () => {
                        if ((phaseOrder[window.__fixtureHydrationState] || 0) >= (phaseOrder[desiredPhase] || 0)) {
                            resolve(window.__fixtureHydrationState);
                            return;
                        }
                        window.setTimeout(check, 10);
                    };
                    check();
                });
            };

            function renderInitialNotebook() {
                renderNotebook(initialNotebookId, initialSources, initialOptions);
            }

            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', renderInitialNotebook, { once: true });
            } else {
                renderInitialNotebook();
            }
        })();
    </script>
</head>
<body>
</body>
</html>`;
}

function defaultCurrentDomTitles() {
    return ['Fake Source 1', 'Fake Source 2', 'Fake Source 3'];
}

// Mirrors the Gemini Notebook Sources panel captured on 2026-10-27 (tests/fixtures/real-dom):
// no data-testid, no stable id attributes, aria-label "More" on the row menu button, and a header
// auto-label button that also carries .source-item-more-button.
// window.__fixtureClicks counts every click, real or synthetic, that reaches a native control.
function renderCurrentDomHtml(notebookId, titles, options = {}) {
    const rowTitles = Array.isArray(titles) && titles.length > 0
        ? titles.map((title) => String(title))
        : defaultCurrentDomTitles();
    const renderRow = (title) => `
                <div class="single-source-container single-source-container-magic-index-only source-sorting-enabled" draggable="false">
                    <button class="source-stretched-button" type="button" aria-label="${escapeHtml(title)}"></button>
                    <div class="icon-and-menu-container icon-and-menu-container-collapsed">
                        <div class="source-item-menu-button-visible">
                            <div class="source-item-icon-container">
                                <mat-icon class="mat-icon notranslate source-item-source-icon icon pdf-icon-color google-symbols" role="img" aria-hidden="true">drive_pdf</mat-icon>
                            </div>
                        </div>
                    </div>
                    <div class="source-title-column" aria-hidden="true">
                        <div class="mat-mdc-tooltip-trigger source-title mat-body-medium" aria-label="${escapeHtml(title)}"><span aria-hidden="true">${escapeHtml(title)}</span></div>
                    </div>
                    <div>
                        <button class="mdc-icon-button mat-mdc-icon-button mat-mdc-menu-trigger source-item-more-button icon-button-small source-item-more-button-magic-index-only" type="button" aria-label="More" aria-expanded="false" aria-haspopup="menu">
                            <div><mat-icon class="mat-icon notranslate source-item-more-menu-icon google-symbols" role="img" aria-hidden="true">more_vert</mat-icon></div>
                        </button>
                    </div>
                    <div class="select-checkbox-container">
                        <mat-checkbox class="mat-mdc-checkbox select-checkbox mat-primary">
                            <label class="mdc-form-field mat-internal-form-field">
                                <span class="mdc-checkbox"><input class="mdc-checkbox__native-control" type="checkbox" aria-label="Select ${escapeHtml(title)}" tabindex="0" checked></span>
                            </label>
                        </mat-checkbox>
                    </div>
                </div>`;
    const rowsHtml = rowTitles.map(renderRow).join('');

    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Notebook ${escapeHtml(notebookId)}</title>
    <style>
        html, body { margin: 0; min-height: 100%; font-family: Arial, sans-serif; }
        body { min-height: 100vh; background: #f6f7fb; color: #1f2937; }
        chat-panel-header, source-picker, nb-button, mat-checkbox, mat-menu { display: block; }
        .app-shell { display: grid; grid-template-columns: 360px 1fr; gap: 24px; padding: 24px; box-sizing: border-box; }
        .source-panel { border: 1px solid #cfd6e4; border-radius: 12px; background: #fff; overflow: hidden; min-height: 320px; }
        .panel-header { display: flex; align-items: center; min-height: 56px; padding: 0 16px; font-weight: 700; border-bottom: 1px solid #e5e7eb; }
        .panel-header h2 { margin: 0; font-size: 16px; }
        .button-row, .label-row { display: flex; align-items: center; gap: 8px; padding: 8px 16px; }
        .label-row-start { display: flex; gap: 4px; }
        .scroll-area-desktop { padding: 8px 16px 16px; }
        .single-source-container { display: flex; align-items: center; gap: 10px; min-height: 44px; margin-bottom: 8px; padding: 6px 12px; position: relative; border: 1px solid #e5e7eb; border-radius: 10px; background: #fbfdff; }
        .source-stretched-button { position: absolute; inset: 0; opacity: 0; border: 0; background: transparent; z-index: 0; }
        .source-title-column { flex: 1; }
        .source-item-more-button, .select-checkbox-container { position: relative; z-index: 1; }
        .cover-subtitle { padding: 12px 24px; color: #6b7280; }
    </style>
</head>
<body>
    <main class="app-shell">
        <chat-panel-header>
            <div class="cover-content">
                <div class="cover-subtitle mat-body-medium"><span class="cover-subtitle-source-count">${rowTitles.length} sources</span></div>
            </div>
        </chat-panel-header>
        <section class="source-panel">
            <div class="panel-header">
                <nav><h2 class="panel-header-content"><span>Sources</span></h2></nav>
            </div>
            <div class="source-panel-content">
                <source-picker class="source-sorting-enabled">
                    <div class="contents">
                        <div>
                            <div class="button-row">
                                <nb-button class="add-source-button"><button type="button" aria-label="Add sources">Add sources</button></nb-button>
                            </div>
                            <div class="source-discovery-container"><source-discovery-query-box><input type="search" aria-label="Search sources on the web"></source-discovery-query-box></div>
                            <div class="row label-row">
                                <div class="label-row-start">
                                    <span>
                                        <button class="mdc-icon-button mat-mdc-icon-button source-item-more-button label-auto-button icon-button-small" type="button" aria-label="Auto-label your sources by topic"><mat-icon class="mat-icon notranslate google-symbols" role="img" aria-hidden="true">layers</mat-icon></button>
                                    </span>
                                    <button class="mdc-icon-button mat-mdc-icon-button mat-mdc-menu-trigger source-sort-button icon-button-small" type="button" aria-label="Sort sources" aria-expanded="false" aria-haspopup="menu"><mat-icon class="mat-icon notranslate google-symbols" role="img" aria-hidden="true">sort</mat-icon></button>
                                </div>
                                <div class="header-title header-title-muted mat-body-medium">
                                    <div class="select-checkbox-all-sources-container">
                                        <mat-checkbox class="mat-mdc-checkbox select-checkbox-all-sources mat-primary">
                                            <label class="mdc-form-field mat-internal-form-field">
                                                <span class="mdc-checkbox"><input class="mdc-checkbox__native-control" type="checkbox" aria-label="Select all sources" tabindex="0" checked></span>
                                            </label>
                                        </mat-checkbox>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="xap-uploader-dropzone sources-list-dropzone has-sources">
                            <div class="scroll-container">
                                <div class="scroll-area-desktop" id="fixture-scroll-area">${options.deferRows ? '' : rowsHtml}</div>
                            </div>
                        </div>
                    </div>
                </source-picker>
            </div>
        </section>
    </main>
    <script>
        (function () {
            const rowsHtml = ${JSON.stringify(rowsHtml)};
            const clicks = { autoLabel: 0, sort: 0, selectAll: 0, rowMore: 0, rowButton: 0, deleted: 0 };
            window.__fixtureClicks = clicks;
            document.addEventListener('click', (event) => {
                const target = event.target instanceof Element ? event.target : null;
                if (!target) return;
                if (target.closest('.label-auto-button')) clicks.autoLabel += 1;
                else if (target.closest('.source-sort-button')) clicks.sort += 1;
                else if (target.closest('.select-checkbox-all-sources')) clicks.selectAll += 1;
                else if (target.closest('.source-item-more-button')) clicks.rowMore += 1;
                else if (target.closest('.source-stretched-button')) clicks.rowButton += 1;
            }, true);
            // Native delete flow: row More menu -> Delete item -> confirm dialog naming the title ->
            // row removed and the header count decremented (like the live page, all synchronously).
            const overlay = document.createElement('div');
            overlay.className = 'cdk-overlay-container';
            document.body.appendChild(overlay);
            const closeOverlay = () => { overlay.innerHTML = ''; };
            const readRowTitle = (row) => row.querySelector('.source-title')?.getAttribute('aria-label') || '';
            document.addEventListener('click', (event) => {
                const target = event.target instanceof Element ? event.target : null;
                if (!target) return;
                const rowMore = target.closest('.single-source-container .source-item-more-button:not(.label-auto-button)');
                if (rowMore) {
                    closeOverlay();
                    const row = rowMore.closest('.single-source-container');
                    row.setAttribute('data-fixture-menu-owner', 'true');
                    const menu = document.createElement('div');
                    menu.className = 'mat-mdc-menu-panel';
                    menu.innerHTML = '<button class="mat-mdc-menu-item" role="menuitem" type="button" data-fixture-delete><mat-icon class="google-symbols">delete</mat-icon><span>Delete source</span></button>';
                    overlay.appendChild(menu);
                    return;
                }
                if (target.closest('[data-fixture-delete]')) {
                    const row = document.querySelector('[data-fixture-menu-owner="true"]');
                    closeOverlay();
                    if (!row) return;
                    const dialog = document.createElement('mat-dialog-container');
                    dialog.setAttribute('role', 'dialog');
                    dialog.innerHTML = '<p class="fixture-dialog-title"></p><button type="button" data-fixture-cancel>Cancel</button><button type="button" class="mat-mdc-button-primary" data-fixture-confirm>Delete</button>';
                    dialog.querySelector('.fixture-dialog-title').textContent = 'Delete ' + readRowTitle(row) + '?';
                    overlay.appendChild(dialog);
                    return;
                }
                if (target.closest('[data-fixture-confirm]')) {
                    const row = document.querySelector('[data-fixture-menu-owner="true"]');
                    closeOverlay();
                    if (!row) return;
                    row.remove();
                    clicks.deleted += 1;
                    const count = document.querySelectorAll('.single-source-container').length;
                    document.querySelector('.cover-subtitle-source-count').textContent = count + (count === 1 ? ' source' : ' sources');
                    return;
                }
                if (target.closest('[data-fixture-cancel]') || !target.closest('.cdk-overlay-container')) {
                    closeOverlay();
                }
            });
            window.__fixtureRenderRows = function renderRows() {
                const scrollArea = document.getElementById('fixture-scroll-area');
                scrollArea.innerHTML = rowsHtml;
                return scrollArea.querySelectorAll('.single-source-container').length;
            };
        })();
    </script>
</body>
</html>`;
}

function renderHomeHtml() {
    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>NotebookLM Home</title>
    <style>
        html, body {
            margin: 0;
            min-height: 100%;
            font-family: Arial, sans-serif;
        }

        body {
            min-height: 100vh;
            display: grid;
            place-items: center;
            background: #f6f7fb;
            color: #1f2937;
        }

        .home-shell {
            padding: 40px;
            border: 1px solid #d7dde8;
            border-radius: 16px;
            background: #fff;
        }
    </style>
</head>
<body>
    <main class="home-shell">NotebookLM Home</main>
</body>
</html>`;
}

async function installNotebookFixture(context, options = {}) {
    const resolveSources = typeof options.resolveSources === 'function'
        ? options.resolveSources
        : null;
    const handleNotebookRoute = async (route) => {
        const request = route.request();
        const url = new URL(request.url());

        if (request.resourceType() !== 'document') {
            await route.fulfill({
                status: 204,
                body: ''
            });
            return;
        }

        if (url.pathname === '/' || url.pathname === '') {
            await route.fulfill({
                status: 200,
                contentType: 'text/html',
                body: renderHomeHtml()
            });
            return;
        }

        const parts = url.pathname.split('/').filter(Boolean);
        const notebookIndex = parts.indexOf('notebook');
        const notebookId = notebookIndex > -1 && notebookIndex + 1 < parts.length
            ? parts[notebookIndex + 1]
            : 'a';

        const fixtureName = url.searchParams.get('fixture');
        const resolvedSources = resolveSources
            ? await Promise.resolve(resolveSources({ fixtureName, notebookId, url }))
            : null;
        const sources = Array.isArray(resolvedSources)
            ? resolvedSources
            : fixtureName === 'malicious-icons'
            ? [
                {
                    id: `${notebookId}-source-a`,
                    title: '<img src=x onerror="window.__sourceTitleXss=1">',
                    token: `${notebookId}-source-a`,
                    iconUrl: 'https://evil.example/icon.png'
                },
                {
                    id: `${notebookId}-source-b`,
                    title: `Notebook ${notebookId} source B`,
                    token: `${notebookId}-source-b`
                }
            ]
                : null;

        if (fixtureName === 'current-dom') {
            await route.fulfill({
                status: 200,
                contentType: 'text/html',
                body: renderCurrentDomHtml(
                    notebookId,
                    Array.isArray(sources) ? sources.map((source) => source.title) : null,
                    { deferRows: url.searchParams.get('rows') === 'deferred' }
                )
            });
            return;
        }

        await route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: renderNotebookHtml(notebookId, sources, {
                stagedHydration: fixtureName === 'staged',
                labelView: ['label', 'label-empty', 'label-collapsed'].includes(fixtureName),
                labelViewWithoutRows: fixtureName === 'label-empty',
                labelViewCollapsedGroups: fixtureName === 'label-collapsed',
                labelViewMaterialGroups: ['material-labels', 'material-labels-noop', 'material-labels-aria'].includes(fixtureName),
                labelViewListSwitchNoop: fixtureName === 'material-labels-noop',
                ariaCheckboxes: fixtureName === 'material-labels-aria'
            })
        });
    };

    await context.route('https://notebook.google.com/**', handleNotebookRoute);
    await context.route('https://notebooklm.google.com/**', handleNotebookRoute);
}

module.exports = {
    defaultSourcesForNotebook,
    installNotebookFixture,
    renderCurrentDomHtml,
    renderHomeHtml,
    renderNotebookHtml
};
