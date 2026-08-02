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
    renderHomeHtml,
    renderNotebookHtml
};
