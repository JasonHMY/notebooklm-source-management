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
            token: source.token || source.id || `${notebookId}-source-${index + 1}`
        }));
    }

    return defaultSourcesForNotebook(notebookId);
}

function renderNotebookHtml(notebookId, sources, options = {}) {
    const renderedSources = normalizeSources(notebookId, sources);
    const initialOptions = {
        stagedHydration: Boolean(options.stagedHydration),
        labelView: Boolean(options.labelView),
        labelViewWithoutRows: Boolean(options.labelViewWithoutRows)
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

            function createSourceItem(source, phase) {
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

                const title = document.createElement('span');
                title.className = 'source-title';
                title.setAttribute('data-testid', 'source-title');
                title.textContent = source.title;

                row.appendChild(icon);
                row.appendChild(title);

                if (phase === 'full') {
                    const checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    checkbox.setAttribute('aria-label', source.title);

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

            function renderSources(scrollArea, sources, phase) {
                scrollArea.replaceChildren();
                sources.forEach((source) => {
                    scrollArea.appendChild(createSourceItem(source, phase));
                });
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

            function createLabelGroup(labelTitle, sources) {
                const group = document.createElement('section');
                group.className = 'source-label-group';
                group.setAttribute('data-testid', 'source-label-group');
                group.setAttribute('aria-label', labelTitle + ' label');
                group.setAttribute('data-label-title', labelTitle);

                const header = document.createElement('button');
                header.type = 'button';
                header.className = 'source-label-title';
                header.setAttribute('aria-label', labelTitle);
                header.textContent = labelTitle;
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.setAttribute('aria-label', labelTitle);
                header.appendChild(checkbox);
                group.appendChild(header);

                sources.forEach((source) => {
                    const item = createSourceItem(source, 'full');
                    item.setAttribute('data-source-label', labelTitle);
                    group.appendChild(item);
                });

                return group;
            }

            function renderLabelView(sourcePanel, sources, options) {
                sourcePanel.appendChild(createLabelViewControls());
                const shouldRenderRows = !options.labelViewWithoutRows;
                sourcePanel.appendChild(createLabelGroup('Research papers', shouldRenderRows ? sources.slice(0, 1) : []));
                sourcePanel.appendChild(createLabelGroup('Reference material', shouldRenderRows ? sources.slice(1) : []));
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
                    renderSources(scrollArea, sources, 'full');
                    setHydrationPhase('full');
                    return;
                }

                setHydrationPhase('empty');
                renderSources(scrollArea, [], 'full');
                scheduleHydrationPhase(() => {
                    renderSources(scrollArea, sources, 'partial');
                    setHydrationPhase('partial');
                }, 40);
                scheduleHydrationPhase(() => {
                    renderSources(scrollArea, sources, 'full');
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
                        labelViewWithoutRows: Boolean(nextNotebook.labelViewWithoutRows)
                    }
                    : initialOptions;
                history.pushState({}, '', '/notebook/' + encodeURIComponent(notebookId));
                renderNotebook(notebookId, sources, options);
                return { notebookId, sourceCount: Array.isArray(sources) ? sources.length : 0 };
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

async function installNotebookFixture(context) {
    await context.route('https://notebooklm.google.com/**', async (route) => {
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

        await route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: renderNotebookHtml(notebookId, null, {
                stagedHydration: url.searchParams.get('fixture') === 'staged',
                labelView: url.searchParams.get('fixture') === 'label' || url.searchParams.get('fixture') === 'label-empty',
                labelViewWithoutRows: url.searchParams.get('fixture') === 'label-empty'
            })
        });
    });
}

module.exports = {
    defaultSourcesForNotebook,
    installNotebookFixture,
    renderHomeHtml,
    renderNotebookHtml
};
