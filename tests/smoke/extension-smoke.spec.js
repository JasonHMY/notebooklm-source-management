const path = require('path');

const { test, expect } = require('@playwright/test');

const {
    closeExtensionContext,
    launchExtensionContext,
    openExtensionPage,
    waitForExtensionId
} = require('./helpers/extension-context');
const {
    installNotebookFixture,
    defaultSourcesForNotebook
} = require('./helpers/notebooklm-fixture');

const repoRoot = path.resolve(__dirname, '../..');
const manifest = require('../../manifest.json');
const SMOKE_WELCOME_ONBOARDING_SEEN_VERSION = 1;
const SMOKE_WHATS_NEW_SEEN_VERSION = manifest.version;

test.describe.serial('extension smoke', () => {
    let env;

    async function readProjectState(projectId, bridgePage) {
        return bridgePage.evaluate(async (targetProjectId) => {
            const key = `sourcesPlusState_${targetProjectId}`;
            const backupKey = `${key}__backup`;
            return new Promise((resolve) => {
                chrome.storage.local.get([key, backupKey], (data) => {
                    resolve({
                        primary: data?.[key] || null,
                        backup: data?.[backupKey] || null
                    });
                });
            });
        }, projectId);
    }

    async function readDeveloperLogs(projectId, bridgePage) {
        return bridgePage.evaluate(async (targetProjectId) => {
            const key = `sourcesPlusDeveloperLogs_${targetProjectId}`;
            return new Promise((resolve) => {
                chrome.storage.local.get([key, 'sourcesPlusPreferences'], (data) => {
                    resolve({
                        preferences: data?.sourcesPlusPreferences || null,
                        logs: data?.[key] || []
                    });
                });
            });
        }, projectId);
    }

    async function unlockDeveloperSettings(notebookPage) {
        const acceptPasswordPrompt = notebookPage.waitForEvent('dialog')
            .then((dialog) => dialog.accept('developer_mode'));
        await notebookPage.evaluate(() => {
            const root = document.querySelector('#sources-plus-root')?.shadowRoot;
            const unlockButton = root?.querySelector('.sp-settings-developer-unlock-btn');
            if (!unlockButton) throw new Error('Developer features unlock button missing.');
            unlockButton.click();
        });
        await acceptPasswordPrompt;
        await expect.poll(async () => notebookPage.evaluate(() => Boolean(
            document.querySelector('#sources-plus-root')?.shadowRoot?.querySelector('.sp-settings-developer-mode-toggle')
        )), { timeout: 10_000 }).toBeTruthy();
    }

    async function resolveExtensionIdAfterBootstrap(targetPath = '/notebook/bootstrap') {
        const bootstrapPage = await env.context.newPage();
        await bootstrapPage.goto(`https://notebooklm.google.com${targetPath}`);
        env.extensionId = await waitForExtensionId(env.context, env.userDataDir, repoRoot);
        await bootstrapPage.close();
    }

    async function seedSmokePreferences() {
        const bridgePage = await openExtensionPage(env.context, env.extensionId, 'src/popup/popup.html');
        try {
            const response = await bridgePage.evaluate(async ({ welcomeOnboardingSeenVersion, whatsNewSeenVersion }) => (
                chrome.runtime.sendMessage({
                    type: 'SAVE_PREFERENCES',
                    preferences: { welcomeOnboardingSeenVersion, whatsNewSeenVersion }
                })
            ), {
                welcomeOnboardingSeenVersion: SMOKE_WELCOME_ONBOARDING_SEEN_VERSION,
                whatsNewSeenVersion: SMOKE_WHATS_NEW_SEEN_VERSION
            });

            if (!response?.success) {
                throw new Error(`Failed to seed smoke preferences: ${response?.errorCode || 'unknown_error'}`);
            }
        } finally {
            await bridgePage.close();
        }
    }

    async function sendNotebookMessage(urlFragment, message) {
        const bridgePage = await openExtensionPage(env.context, env.extensionId, 'src/popup/popup.html');
        try {
            return await bridgePage.evaluate(async ({ targetUrlFragment, request }) => {
                const tabs = await chrome.tabs.query({ url: 'https://notebooklm.google.com/*' });
                const targetTab = tabs.find((tab) => tab.url && tab.url.includes(targetUrlFragment));

                if (!targetTab || typeof targetTab.id !== 'number') {
                    throw new Error(`Notebook tab was not found for ${targetUrlFragment}.`);
                }

                return chrome.tabs.sendMessage(targetTab.id, request);
            }, { targetUrlFragment: urlFragment, request: message });
        } finally {
            await bridgePage.close();
        }
    }

    test.beforeEach(async () => {
        env = await launchExtensionContext(repoRoot);
        await installNotebookFixture(env.context);
        env.extensionId = await waitForExtensionId(env.context, env.userDataDir, repoRoot);
        await seedSmokePreferences();
    });

    test.afterEach(async () => {
        await closeExtensionContext(env);
        env = null;
    });

    test('boots extension and renders the popup shell', async () => {
        const errors = [];
        await resolveExtensionIdAfterBootstrap();
        const popupPage = await openExtensionPage(env.context, env.extensionId, 'src/popup/popup.html');

        popupPage.on('pageerror', (error) => errors.push(error));
        popupPage.on('console', (message) => {
            if (message.type() === 'error') {
                errors.push(new Error(message.text()));
            }
        });

        await expect(popupPage.locator('#popup-badge')).toBeVisible();
        await expect(popupPage.locator('#popup-title')).toBeVisible();
        await expect(popupPage.locator('#popup-primary-btn')).toBeVisible();
        await expect(popupPage.locator('#popup-primary-btn')).not.toHaveText('');

        expect(errors).toEqual([]);
    });

    test('injects the manager and handles the message bridge on the current Notebook host', async () => {
        const pageErrors = [];
        const notebookPage = await env.context.newPage();

        notebookPage.on('pageerror', (error) => pageErrors.push(error));
        notebookPage.on('console', (message) => {
            if (message.type() === 'error') {
                pageErrors.push(new Error(message.text()));
            }
        });

        await notebookPage.goto('https://notebook.google.com/notebook/a');
        env.extensionId = await waitForExtensionId(env.context, env.userDataDir, repoRoot);
        const bridgePage = await openExtensionPage(env.context, env.extensionId, 'src/popup/popup.html');

        await expect(notebookPage.locator('#sources-plus-root')).toBeVisible({ timeout: 20_000 });
        await expect(notebookPage.locator('[data-testid="source-panel"]')).toBeVisible();

        const status = await bridgePage.evaluate(async () => {
            const tabs = await chrome.tabs.query({
                url: [
                    'https://notebook.google.com/*',
                    'https://notebooklm.google.com/*'
                ]
            });
            const targetTab = tabs.find((tab) => tab.url && tab.url.includes('/notebook/a'));

            if (!targetTab || typeof targetTab.id !== 'number') {
                throw new Error('Notebook tab was not found.');
            }

            return chrome.tabs.sendMessage(targetTab.id, { type: 'GET_MANAGER_STATUS' });
        });

        expect(status).toMatchObject({ ready: true, reason: 'ready' });

        const focusResult = await bridgePage.evaluate(async () => {
            const tabs = await chrome.tabs.query({
                url: [
                    'https://notebook.google.com/*',
                    'https://notebooklm.google.com/*'
                ]
            });
            const targetTab = tabs.find((tab) => tab.url && tab.url.includes('/notebook/a'));

            if (!targetTab || typeof targetTab.id !== 'number') {
                throw new Error('Notebook tab was not found.');
            }

            return chrome.tabs.sendMessage(targetTab.id, { type: 'FOCUS_MANAGER' });
        });

        expect(focusResult).toEqual({ success: true });
        await expect.poll(async () => notebookPage.evaluate(() => Boolean(
            document.querySelector('#sources-plus-root')?.shadowRoot?.querySelector('.sp-focus-ring')
        ))).toBeTruthy();
        expect(pageErrors).toEqual([]);
    });

    test('keeps accessibility controls operable in forced colors, narrow panels, and high zoom', async () => {
        const pageErrors = [];
        const notebookPage = await env.context.newPage();
        await notebookPage.emulateMedia({
            forcedColors: 'active',
            reducedMotion: 'reduce'
        });
        notebookPage.on('pageerror', (error) => pageErrors.push(error));
        notebookPage.on('console', (message) => {
            if (message.type() === 'error') {
                pageErrors.push(new Error(message.text()));
            }
        });

        await notebookPage.goto('https://notebooklm.google.com/notebook/accessibility');
        env.extensionId = await waitForExtensionId(env.context, env.userDataDir, repoRoot);
        const bridgePage = await openExtensionPage(env.context, env.extensionId, 'src/popup/popup.html');
        await expect(notebookPage.locator('#sources-plus-root')).toBeVisible({ timeout: 20_000 });
        await expect(notebookPage.locator('#sources-list .source-item')).toHaveCount(2);
        await notebookPage.evaluate(() => new Promise(
            (resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))
        ));

        const resizer = notebookPage.locator('.sp-resizer');
        await notebookPage.locator('#sp-settings-btn').focus();
        await resizer.focus();
        const initialResizerState = await notebookPage.evaluate(() => {
            const root = document.querySelector('#sources-plus-root')?.shadowRoot || null;
            const separator = root?.querySelector('.sp-resizer') || null;
            if (!root || !separator) return null;
            const handleStyle = window.getComputedStyle(separator, '::after');
            return {
                forcedColors: window.matchMedia('(forced-colors: active)').matches,
                reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
                role: separator.getAttribute('role'),
                orientation: separator.getAttribute('aria-orientation'),
                valueMin: Number(separator.getAttribute('aria-valuemin')),
                valueMax: Number(separator.getAttribute('aria-valuemax')),
                valueNow: Number(separator.getAttribute('aria-valuenow')),
                valueText: separator.getAttribute('aria-valuetext'),
                tabIndex: separator.tabIndex,
                focused: root.activeElement === separator,
                containerHeight: Math.round(
                    root.querySelector('.sp-container')?.getBoundingClientRect().height || 0
                ),
                forcedColorAdjust: window.getComputedStyle(separator).forcedColorAdjust,
                handleColor: handleStyle.backgroundColor
            };
        });

        expect(initialResizerState).toMatchObject({
            forcedColors: true,
            reducedMotion: true,
            role: 'separator',
            orientation: 'horizontal',
            tabIndex: 0,
            focused: true,
            forcedColorAdjust: 'auto'
        });
        expect(initialResizerState.valueMin).toBe(150);
        expect(initialResizerState.valueMax).toBeGreaterThan(initialResizerState.valueMin);
        expect(initialResizerState.valueNow).toBeGreaterThanOrEqual(initialResizerState.valueMin);
        expect(initialResizerState.valueNow).toBeLessThanOrEqual(initialResizerState.valueMax);
        expect(initialResizerState.valueText).toBe(`${initialResizerState.valueNow} px`);
        expect(initialResizerState.handleColor).not.toBe('rgba(0, 0, 0, 0)');

        const expectedKeyboardHeight = Math.min(
            initialResizerState.valueMax,
            Math.max(initialResizerState.valueMin, initialResizerState.containerHeight + 16)
        );
        await resizer.press('ArrowDown');
        await expect.poll(async () => Number(await resizer.getAttribute('aria-valuenow')))
            .toBe(expectedKeyboardHeight);
        await expect(resizer).toHaveAttribute('aria-valuetext', `${expectedKeyboardHeight} px`);
        await expect.poll(async () => notebookPage.evaluate(() => Math.round(
            document.querySelector('#sources-plus-root')?.shadowRoot
                ?.querySelector('.sp-container')?.getBoundingClientRect().height || 0
        ))).toBe(expectedKeyboardHeight);

        await notebookPage.locator('#sp-settings-btn').click();
        await expect(notebookPage.locator('.sp-settings-open-command-palette-btn')).toBeVisible();
        await notebookPage.locator('.sp-settings-open-command-palette-btn').click();
        await expect(notebookPage.locator('.sp-command-palette-input')).toBeVisible();

        const forcedColorPaletteState = await notebookPage.evaluate(() => {
            const root = document.querySelector('#sources-plus-root')?.shadowRoot || null;
            const input = root?.querySelector('.sp-command-palette-input') || null;
            const listbox = root?.querySelector('.sp-command-palette-list') || null;
            const option = root?.querySelector('.sp-command-palette-item.is-active') || null;
            if (!input || !listbox || !option) return null;
            const optionStyle = window.getComputedStyle(option);
            return {
                inputRole: input.getAttribute('role'),
                inputExpanded: input.getAttribute('aria-expanded'),
                inputControls: input.getAttribute('aria-controls'),
                inputActiveDescendant: input.getAttribute('aria-activedescendant'),
                inputForcedColorAdjust: window.getComputedStyle(input).forcedColorAdjust,
                listRole: listbox.getAttribute('role'),
                optionRole: option.getAttribute('role'),
                optionForcedColorAdjust: optionStyle.forcedColorAdjust,
                optionOutlineStyle: optionStyle.outlineStyle,
                optionOutlineWidth: optionStyle.outlineWidth
            };
        });

        expect(forcedColorPaletteState).toMatchObject({
            inputRole: 'combobox',
            inputExpanded: 'true',
            inputForcedColorAdjust: 'auto',
            listRole: 'listbox',
            optionRole: 'option',
            optionForcedColorAdjust: 'auto',
            optionOutlineStyle: 'solid',
            optionOutlineWidth: '2px'
        });
        expect(forcedColorPaletteState.inputControls).not.toBe('');
        expect(forcedColorPaletteState.inputActiveDescendant).not.toBe('');

        await notebookPage.locator('.sp-command-palette-input').press('Escape');
        await expect(notebookPage.locator('.sp-command-palette-input')).toHaveCount(0);
        await notebookPage.emulateMedia({
            forcedColors: 'none',
            reducedMotion: 'no-preference'
        });

        await notebookPage.locator('#sp-new-group-btn').click();
        const groupNameInput = notebookPage.locator('.sp-inline-group-name-input');
        await expect(groupNameInput).toBeVisible();
        await groupNameInput.fill('Research');
        await groupNameInput.press('Enter');
        await expect(notebookPage.locator('.group-title')).toHaveText('Research');

        const setPanelWidth = async (width) => {
            await notebookPage.evaluate(async (nextWidth) => {
                const panel = document.querySelector('[data-testid="source-panel"]');
                if (!panel) throw new Error('Synthetic source panel missing.');
                if (Number.isFinite(nextWidth)) {
                    panel.style.width = `${nextWidth}px`;
                    panel.style.minWidth = `${nextWidth}px`;
                    panel.style.maxWidth = `${nextWidth}px`;
                } else {
                    panel.style.removeProperty('width');
                    panel.style.removeProperty('min-width');
                    panel.style.removeProperty('max-width');
                }
                await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            }, width);
        };

        const readFolderTitleLayout = async () => notebookPage.evaluate(() => {
            const root = document.querySelector('#sources-plus-root')?.shadowRoot || null;
            const title = root?.querySelector('.group-title') || null;
            if (!root || !title) return null;

            const titleRect = title.getBoundingClientRect();
            const titleStyle = window.getComputedStyle(title);
            const folderActionSelectors = [
                '.group-header > .sp-add-subgroup-button',
                '.group-header > .sp-isolate-button',
                '.group-header > .sp-edit-button',
                '.group-header > .sp-delete-button',
                '.group-header > .sp-tree-order-controls .sp-tree-order-button'
            ];
            const folderActions = folderActionSelectors.map((selector) => (
                root.querySelector(selector)
            ));
            const badge = root.querySelector('.group-header > .badge');
            const visibleInLayout = (element) => Boolean(
                element && window.getComputedStyle(element).display !== 'none'
            );
            return {
                text: title.textContent?.trim() || '',
                width: titleRect.width,
                height: titleRect.height,
                clientWidth: title.clientWidth,
                clientHeight: title.clientHeight,
                scrollWidth: title.scrollWidth,
                scrollHeight: title.scrollHeight,
                display: titleStyle.display,
                visibility: titleStyle.visibility,
                badgeDisplayed: visibleInLayout(badge),
                folderActionsDisplayed: folderActions.every(visibleInLayout)
            };
        });

        for (const width of [240, 320]) {
            await setPanelWidth(width);
            const folderTitleLayout = await readFolderTitleLayout();
            expect(folderTitleLayout).toMatchObject({
                text: 'Research',
                visibility: 'visible',
                badgeDisplayed: true,
                folderActionsDisplayed: true
            });
            expect(folderTitleLayout.display).not.toBe('none');
            expect(folderTitleLayout.width).toBeGreaterThanOrEqual(40);
            expect(folderTitleLayout.height).toBeGreaterThan(0);
            expect(folderTitleLayout.scrollWidth).toBeLessThanOrEqual(folderTitleLayout.clientWidth + 1);
            expect(folderTitleLayout.scrollHeight).toBeLessThanOrEqual(folderTitleLayout.clientHeight + 1);
        }

        await setPanelWidth(null);
        await notebookPage.locator('#sp-batch-action-btn').click();
        await expect(notebookPage.locator('.sp-batch-action-bar')).toBeVisible();

        const readHorizontalLayout = async () => notebookPage.evaluate(() => {
            const root = document.querySelector('#sources-plus-root')?.shadowRoot || null;
            const host = document.querySelector('#sources-plus-root');
            const container = root?.querySelector('.sp-container') || null;
            if (!root || !host || !container) return null;

            const containerRect = container.getBoundingClientRect();
            const regionSelectors = [
                '.sp-controls',
                '.sp-toolbar-actions',
                '.sp-batch-action-bar',
                '.sp-batch-toolbar',
                '.sp-batch-actions'
            ];
            const regions = regionSelectors
                .map((selector) => root.querySelector(selector))
                .filter(Boolean);
            const controls = Array.from(root.querySelectorAll(
                '.sp-controls button, .sp-batch-action-bar button, .sp-batch-selection-count'
            )).filter((element) => {
                const rect = element.getBoundingClientRect();
                const style = window.getComputedStyle(element);
                return (
                    rect.width > 0 &&
                    rect.height > 0 &&
                    style.visibility !== 'hidden' &&
                    Number.parseFloat(style.opacity || '1') > 0.01
                );
            });
            const controlRects = controls.map((element, index) => {
                const rect = element.getBoundingClientRect();
                return {
                    key: element.id || element.className || `control-${index}`,
                    left: rect.left,
                    right: rect.right,
                    top: rect.top,
                    bottom: rect.bottom
                };
            });
            const overlaps = [];
            for (let leftIndex = 0; leftIndex < controlRects.length; leftIndex += 1) {
                for (let rightIndex = leftIndex + 1; rightIndex < controlRects.length; rightIndex += 1) {
                    const left = controlRects[leftIndex];
                    const right = controlRects[rightIndex];
                    const horizontal = Math.min(left.right, right.right) - Math.max(left.left, right.left);
                    const vertical = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
                    if (horizontal > 0.5 && vertical > 0.5) {
                        overlaps.push(`${left.key}|${right.key}`);
                    }
                }
            }

            return {
                viewportWidth: window.innerWidth,
                panelWidth: document.querySelector('[data-testid="source-panel"]')?.getBoundingClientRect().width || 0,
                containerWidth: containerRect.width,
                hostOverflow: Math.max(0, host.scrollWidth - host.clientWidth),
                regionOverflow: regions
                    .filter((element) => element.scrollWidth > element.clientWidth + 1)
                    .map((element) => element.className),
                clippedControls: controlRects
                    .filter((rect) => (
                        rect.left < containerRect.left - 1 ||
                        rect.right > containerRect.right + 1
                    ))
                    .map((rect) => rect.key),
                overlaps,
                controlCount: controlRects.length
            };
        });

        for (const width of [240, 320]) {
            await setPanelWidth(width);
            const layout = await readHorizontalLayout();
            expect(layout.containerWidth).toBeCloseTo(width, 0);
            expect(layout.panelWidth).toBeCloseTo(layout.containerWidth + 2, 0);
            expect(layout.controlCount).toBeGreaterThan(10);
            expect(layout.hostOverflow).toBeLessThanOrEqual(1);
            expect(layout.regionOverflow).toEqual([]);
            expect(layout.clippedControls).toEqual([]);
            expect(layout.overlaps).toEqual([]);
        }

        await setPanelWidth(null);
        const setNotebookZoom = async (zoomFactor) => bridgePage.evaluate(
            ({ urlFragment, factor }) => new Promise((resolve, reject) => {
                chrome.tabs.query({
                    url: [
                        'https://notebook.google.com/*',
                        'https://notebooklm.google.com/*'
                    ]
                }, (tabs) => {
                    const queryError = chrome.runtime.lastError;
                    if (queryError) {
                        reject(new Error(queryError.message));
                        return;
                    }
                    const targetTab = tabs.find((tab) => tab.url && tab.url.includes(urlFragment));
                    if (!targetTab || typeof targetTab.id !== 'number') {
                        reject(new Error(`Notebook tab was not found for ${urlFragment}.`));
                        return;
                    }
                    chrome.tabs.setZoom(targetTab.id, factor, () => {
                        const zoomError = chrome.runtime.lastError;
                        if (zoomError) {
                            reject(new Error(zoomError.message));
                            return;
                        }
                        chrome.tabs.getZoom(targetTab.id, (actualZoom) => {
                            const getZoomError = chrome.runtime.lastError;
                            if (getZoomError) {
                                reject(new Error(getZoomError.message));
                                return;
                            }
                            resolve(actualZoom);
                        });
                    });
                });
            }),
            { urlFragment: '/notebook/accessibility', factor: zoomFactor }
        );

        for (const zoomFactor of [2, 4]) {
            expect(await setNotebookZoom(zoomFactor)).toBeCloseTo(zoomFactor, 5);
            await expect.poll(async () => (await readHorizontalLayout()).viewportWidth)
                .toBeLessThanOrEqual(Math.ceil(1440 / zoomFactor));
            const layout = await readHorizontalLayout();
            expect(layout.controlCount).toBeGreaterThan(10);
            expect(layout.hostOverflow).toBeLessThanOrEqual(1);
            expect(layout.regionOverflow).toEqual([]);
            expect(layout.clippedControls).toEqual([]);
            expect(layout.overlaps).toEqual([]);
        }

        expect(pageErrors).toEqual([]);
    });

    test('developer mode records sanitized logs only while enabled', async () => {
        const projectId = 'developer-logs';
        const notebookPage = await env.context.newPage();

        await notebookPage.goto(`https://notebooklm.google.com/notebook/${projectId}`);
        env.extensionId = await waitForExtensionId(env.context, env.userDataDir, repoRoot);
        await expect(notebookPage.locator('#sources-plus-root')).toBeVisible({ timeout: 20_000 });

        const bridgePage = await openExtensionPage(env.context, env.extensionId, 'src/popup/popup.html');
        await notebookPage.evaluate(() => {
            const root = document.querySelector('#sources-plus-root')?.shadowRoot;
            const settingsButton = root?.getElementById('sp-settings-btn');
            if (!settingsButton) throw new Error('Settings button missing.');
            settingsButton.click();
        });
        await unlockDeveloperSettings(notebookPage);
        await notebookPage.evaluate(() => {
            const root = document.querySelector('#sources-plus-root')?.shadowRoot;
            const toggle = root.querySelector('.sp-settings-developer-mode-toggle');
            if (!toggle) throw new Error('Developer mode toggle missing.');
            toggle.checked = true;
            toggle.dispatchEvent(new Event('change', { bubbles: true }));
        });

        await expect.poll(async () => {
            const state = await readDeveloperLogs(projectId, bridgePage);
            return Boolean(state.preferences?.developerModeEnabled);
        }, { timeout: 10_000 }).toBeTruthy();

        await notebookPage.reload();
        await expect(notebookPage.locator('#sources-plus-root')).toBeVisible({ timeout: 20_000 });
        await notebookPage.evaluate(() => {
            const root = document.querySelector('#sources-plus-root')?.shadowRoot;
            const settingsButton = root?.getElementById('sp-settings-btn');
            if (!settingsButton) throw new Error('Settings button missing after developer reload.');
            settingsButton.click();
        });
        await expect.poll(async () => notebookPage.evaluate(() => {
            const root = document.querySelector('#sources-plus-root')?.shadowRoot || null;
            const toggle = root?.querySelector('.sp-settings-developer-mode-toggle') || null;
            return toggle ? toggle.checked : null;
        }), { timeout: 10_000 }).toBe(true);

        await sendNotebookMessage(projectId, { type: 'SWITCH_SOURCE_VIEW', viewKind: 'label' });

        // The native source-view switch retries before it resolves, and the background
        // developer-log write that follows can land >20s later when the machine is loaded
        // (e.g. during `verify:full`, right after the unit suite). The log does get written —
        // this poll was observed flaky at both 10s and 20s — so give it a generous window.
        await expect.poll(async () => {
            const state = await readDeveloperLogs(projectId, bridgePage);
            return state.logs.some((entry) => (
                entry.category === 'view_switch' &&
                (entry.event === 'source_view_switch_succeeded' || entry.event === 'source_view_switch_failed')
            ));
        }, { timeout: 35_000 }).toBeTruthy();

        const enabledState = await readDeveloperLogs(projectId, bridgePage);
        expect(JSON.stringify(enabledState.logs)).not.toContain('Academic Research Notes');

        await bridgePage.evaluate(async () => {
            await chrome.runtime.sendMessage({
                type: 'SAVE_PREFERENCES',
                preferences: { developerModeEnabled: false }
            });
        });
        await notebookPage.reload();
        await expect(notebookPage.locator('#sources-plus-root')).toBeVisible({ timeout: 20_000 });
        await notebookPage.evaluate(() => {
            const root = document.querySelector('#sources-plus-root')?.shadowRoot;
            const settingsButton = root?.getElementById('sp-settings-btn');
            if (!settingsButton) throw new Error('Settings button missing after reload.');
            settingsButton.click();
        });
        await unlockDeveloperSettings(notebookPage);
        await expect.poll(async () => notebookPage.evaluate(() => {
            const toggle = document.querySelector('#sources-plus-root')?.shadowRoot?.querySelector('.sp-settings-developer-mode-toggle');
            return toggle ? toggle.checked : null;
        }), { timeout: 10_000 }).toBe(false);

        await expect.poll(async () => {
            const state = await readDeveloperLogs(projectId, bridgePage);
            return state.preferences?.developerModeEnabled === false;
        }, { timeout: 10_000 }).toBeTruthy();
        const disabledBaseline = (await readDeveloperLogs(projectId, bridgePage)).logs.length;

        await sendNotebookMessage(projectId, { type: 'SWITCH_SOURCE_VIEW', viewKind: 'list' });

        await expect.poll(async () => {
            const state = await readDeveloperLogs(projectId, bridgePage);
            return state.logs.length;
        }, { timeout: 2_000 }).toBe(disabledBaseline);

        await bridgePage.close();
    });

    test('switches NotebookLM source views from the popup controls', async () => {
        const notebookPage = await env.context.newPage();

        await notebookPage.goto('https://notebooklm.google.com/notebook/popup-view-switch?fixture=material-labels');
        env.extensionId = await waitForExtensionId(env.context, env.userDataDir, repoRoot);
        await expect(notebookPage.locator('#sources-plus-root')).toBeVisible({ timeout: 20_000 });

        const popupPage = await openExtensionPage(env.context, env.extensionId, 'src/popup/popup.html');
        await popupPage.evaluate(async () => {
            const tabs = await chrome.tabs.query({ url: 'https://notebooklm.google.com/*' });
            const targetTab = tabs.find((tab) => tab.url && tab.url.includes('/notebook/popup-view-switch'));

            if (!targetTab || typeof targetTab.id !== 'number') {
                throw new Error('Popup view switch notebook tab was not found.');
            }

            await chrome.tabs.update(targetTab.id, { active: true });
        });
        await popupPage.reload();
        await popupPage.waitForLoadState('domcontentloaded');

        await expect(popupPage.locator('#popup-source-view-section')).toBeVisible({ timeout: 10_000 });
        await expect(popupPage.locator('#popup-source-view-list-btn')).toHaveAttribute('aria-pressed', 'true');

        await popupPage.locator('#popup-source-view-label-btn').click();

        await expect.poll(async () => notebookPage.evaluate(() => Boolean(
            document.querySelector('mat-expansion-panel')
        )), { timeout: 10_000 }).toBeTruthy();
        await expect.poll(async () => notebookPage.evaluate(() => Boolean(
            document.querySelector('#sources-plus-root')?.shadowRoot?.querySelector('.sp-container.is-native-label-view')
        )), { timeout: 10_000 }).toBeTruthy();
        await expect(popupPage.locator('#popup-source-view-label-btn')).toHaveAttribute('aria-pressed', 'true');

        await popupPage.locator('#popup-source-view-list-btn').click();

        await expect.poll(async () => notebookPage.evaluate(() => Boolean(
            document.querySelector('#sources-plus-root')?.shadowRoot?.querySelector('.sp-container:not(.is-native-label-view)')
        )), { timeout: 10_000 }).toBeTruthy();
        await expect.poll(async () => notebookPage.evaluate(() => {
            const utilityControls = document.querySelector('[data-testid="native-source-utility-controls"]');
            if (!utilityControls) return false;
            const style = window.getComputedStyle(utilityControls);
            return style.visibility !== 'hidden' &&
                style.display !== 'none' &&
                style.opacity !== '0' &&
                style.pointerEvents !== 'none';
        }), { timeout: 10_000 }).toBeTruthy();
        await expect.poll(async () => notebookPage.evaluate(() => {
            const panels = Array.from(document.querySelectorAll('mat-expansion-panel'));
            if (panels.length === 0) return true;
            return panels.every((panel) => {
                const style = window.getComputedStyle(panel);
                return style.visibility === 'hidden' ||
                    style.display === 'none' ||
                    style.opacity === '0' ||
                    style.pointerEvents === 'none';
            });
        }), { timeout: 10_000 }).toBeTruthy();
        await expect(popupPage.locator('#popup-source-view-list-btn')).toHaveAttribute('aria-pressed', 'true');

        await notebookPage.evaluate(() => {
            const root = document.querySelector('#sources-plus-root')?.shadowRoot;
            const checkbox = root?.querySelector('.source-item .sp-checkbox');
            if (!checkbox) throw new Error('Plugin source checkbox missing after list switch.');
            checkbox.click();
        });
        await expect.poll(async () => notebookPage.evaluate(() => (
            Boolean(document.querySelector('[data-testid="source-item"] input[type="checkbox"]')?.checked)
        )), { timeout: 10_000 }).toBeTruthy();

        await notebookPage.evaluate(() => {
            const root = document.querySelector('#sources-plus-root')?.shadowRoot;
            const checkbox = root?.querySelector('.source-item .sp-checkbox');
            if (!checkbox) throw new Error('Plugin source checkbox missing before deselect.');
            checkbox.click();
        });
        await expect.poll(async () => notebookPage.evaluate(() => (
            Boolean(document.querySelector('[data-testid="source-item"] input[type="checkbox"]')?.checked)
        )), { timeout: 10_000 }).toBeFalsy();
    });

    test('keeps ARIA native checkbox state when switching label view back to list', async () => {
        const notebookPage = await env.context.newPage();

        await notebookPage.goto('https://notebooklm.google.com/notebook/popup-view-switch-aria?fixture=material-labels-aria');
        env.extensionId = await waitForExtensionId(env.context, env.userDataDir, repoRoot);
        await expect(notebookPage.locator('#sources-plus-root')).toBeVisible({ timeout: 20_000 });

        const popupPage = await openExtensionPage(env.context, env.extensionId, 'src/popup/popup.html');
        await popupPage.evaluate(async () => {
            const tabs = await chrome.tabs.query({ url: 'https://notebooklm.google.com/*' });
            const targetTab = tabs.find((tab) => tab.url && tab.url.includes('/notebook/popup-view-switch-aria'));

            if (!targetTab || typeof targetTab.id !== 'number') {
                throw new Error('Popup ARIA view switch notebook tab was not found.');
            }

            await chrome.tabs.update(targetTab.id, { active: true });
        });
        await popupPage.reload();
        await popupPage.waitForLoadState('domcontentloaded');

        await expect(popupPage.locator('#popup-source-view-section')).toBeVisible({ timeout: 10_000 });
        await popupPage.locator('#popup-source-view-label-btn').click();
        await expect(notebookPage.locator('mat-expansion-panel').first()).toBeVisible({ timeout: 10_000 });

        await popupPage.locator('#popup-source-view-list-btn').click();
        await expect.poll(async () => notebookPage.evaluate(() => Boolean(
            document.querySelector('#sources-plus-root')?.shadowRoot?.querySelector('.sp-container:not(.is-native-label-view)')
        )), { timeout: 10_000 }).toBeTruthy();

        await expect.poll(async () => notebookPage.evaluate(() => (
            Array.from(document.querySelectorAll('[data-testid="source-item"] [role="checkbox"]'))
                .map((checkbox) => checkbox.getAttribute('aria-checked'))
        )), { timeout: 10_000 }).toHaveLength(2);

        const statesBeforeToggle = await notebookPage.evaluate(() => (
            Array.from(document.querySelectorAll('[data-testid="source-item"] [role="checkbox"]'))
                .map((checkbox) => checkbox.getAttribute('aria-checked'))
        ));
        await expect.poll(async () => notebookPage.evaluate(() => {
            const nativeChecked = Array.from(document.querySelectorAll('[data-testid="source-item"] [role="checkbox"]'))
                .map((checkbox) => checkbox.getAttribute('aria-checked') === 'true');
            const root = document.querySelector('#sources-plus-root')?.shadowRoot || null;
            const managerChecked = Array.from(root?.querySelectorAll('#sources-list .source-item .sp-checkbox') || [])
                .map((checkbox) => checkbox.checked);
            return { nativeChecked, managerChecked };
        }), { timeout: 10_000 }).toEqual({
            nativeChecked: statesBeforeToggle.map((state) => state === 'true'),
            managerChecked: statesBeforeToggle.map((state) => state === 'true')
        });

        await notebookPage.evaluate(() => {
            const root = document.querySelector('#sources-plus-root')?.shadowRoot;
            const checkbox = root?.querySelector('.source-item .sp-checkbox');
            if (!checkbox) throw new Error('Plugin source checkbox missing after ARIA list switch.');
            checkbox.click();
        });
        const expectedFirstState = statesBeforeToggle[0] === 'true' ? 'false' : 'true';
        await expect.poll(async () => notebookPage.evaluate(() => (
            document.querySelector('[data-testid="source-item"] [role="checkbox"]')?.getAttribute('aria-checked')
        )), { timeout: 10_000 }).toBe(expectedFirstState);
    });

    test('falls back to plugin list display when the native list view switch is not confirmed', async () => {
        const notebookPage = await env.context.newPage();

        await notebookPage.goto('https://notebooklm.google.com/notebook/popup-view-switch-noop?fixture=material-labels-noop');
        env.extensionId = await waitForExtensionId(env.context, env.userDataDir, repoRoot);
        await expect(notebookPage.locator('#sources-plus-root')).toBeVisible({ timeout: 20_000 });

        const popupPage = await openExtensionPage(env.context, env.extensionId, 'src/popup/popup.html');
        await popupPage.evaluate(async () => {
            const tabs = await chrome.tabs.query({ url: 'https://notebooklm.google.com/*' });
            const targetTab = tabs.find((tab) => tab.url && tab.url.includes('/notebook/popup-view-switch-noop'));

            if (!targetTab || typeof targetTab.id !== 'number') {
                throw new Error('Popup no-op view switch notebook tab was not found.');
            }

            await chrome.tabs.update(targetTab.id, { active: true });
        });
        await popupPage.reload();
        await popupPage.waitForLoadState('domcontentloaded');

        await popupPage.locator('#popup-source-view-label-btn').click();
        await expect(popupPage.locator('#popup-source-view-label-btn')).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(async () => notebookPage.evaluate(() => Boolean(
            document.querySelector('#sources-plus-root')?.shadowRoot?.querySelector('.sp-container.is-native-label-view')
        )), { timeout: 10_000 }).toBeTruthy();

        await popupPage.locator('#popup-source-view-list-btn').click();

        await expect(popupPage.locator('#popup-source-view-list-btn')).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(async () => notebookPage.evaluate(() => Boolean(
            document.querySelector('#sources-plus-root')?.shadowRoot?.querySelector('.sp-container:not(.is-native-label-view)')
        )), { timeout: 10_000 }).toBeTruthy();
        await expect.poll(async () => notebookPage.evaluate(() => {
            const panels = Array.from(document.querySelectorAll('mat-expansion-panel'));
            if (panels.length === 0) return true;
            return panels.every((panel) => {
                const style = window.getComputedStyle(panel);
                return style.visibility === 'hidden' ||
                    style.display === 'none' ||
                    style.opacity === '0' ||
                    style.pointerEvents === 'none';
            });
        }), { timeout: 10_000 }).toBeTruthy();
        await expect(popupPage.locator('#popup-detail')).toBeHidden({ timeout: 10_000 });
    });

    test('persists collapsed native label group checkbox changes before a native list switch', async () => {
        const notebookPage = await env.context.newPage();

        await notebookPage.goto('https://notebooklm.google.com/notebook/native-label-direct-switch');
        env.extensionId = await waitForExtensionId(env.context, env.userDataDir, repoRoot);
        await expect(notebookPage.locator('#sources-plus-root')).toBeVisible({ timeout: 20_000 });

        await sendNotebookMessage('/notebook/native-label-direct-switch', { type: 'SWITCH_SOURCE_VIEW', viewKind: 'label' });
        await expect(notebookPage.locator('[data-testid="source-label-group"]').first()).toBeVisible({ timeout: 10_000 });
        await expect(notebookPage.locator('[data-testid="source-label-group"] [data-testid="source-title"]').first()).toBeVisible({ timeout: 10_000 });

        await notebookPage.evaluate(() => {
            document.querySelectorAll('[data-testid="source-label-group"]').forEach((group) => {
                group.querySelector('[aria-expanded]')?.setAttribute('aria-expanded', 'false');
                group.querySelectorAll('[data-testid="source-item"]').forEach((sourceRow) => sourceRow.remove());
            });
        });

        const firstGroupCheckbox = notebookPage.locator('[data-testid="source-label-group"] input[type="checkbox"]').first();
        await firstGroupCheckbox.click();
        await expect.poll(async () => firstGroupCheckbox.evaluate((checkbox) => checkbox.checked), { timeout: 5_000 }).toBe(true);

        await notebookPage.locator('[data-testid="source-view-list-button"]').click();

        await expect.poll(async () => notebookPage.evaluate(() => {
            const root = document.querySelector('#sources-plus-root')?.shadowRoot || null;
            return Array.from(root?.querySelectorAll('#sources-list .source-item .sp-checkbox') || [])
                .map((checkbox) => checkbox.checked);
        }), { timeout: 10_000 }).toEqual([true, false]);
    });

    test('keeps NotebookLM label view visible in compact compatibility mode', async () => {
        const notebookPage = await env.context.newPage();

        await notebookPage.goto('https://notebooklm.google.com/notebook/label-view?fixture=label');
        env.extensionId = await waitForExtensionId(env.context, env.userDataDir, repoRoot);
        const bridgePage = await openExtensionPage(env.context, env.extensionId, 'src/popup/popup.html');

        const savedTallState = {
            schemaVersion: 3,
            groups: [],
            groupsById: {},
            ungrouped: [],
            sourceStateById: {},
            customHeight: 900,
            tagsById: {},
            tagOrder: [],
            sourceTagsById: {}
        };
        await bridgePage.evaluate(async (state) => {
            await new Promise((resolve) => {
                chrome.storage.local.set({
                    'sourcesPlusState_label-view': state,
                    'sourcesPlusState_label-view__backup': state
                }, resolve);
            });
        }, savedTallState);
        await notebookPage.reload();

        await expect(notebookPage.locator('#sources-plus-root')).toBeVisible({ timeout: 20_000 });
        await bridgePage.evaluate(async () => {
            const tabs = await chrome.tabs.query({ url: 'https://notebooklm.google.com/*' });
            const targetTab = tabs.find((tab) => tab.url && tab.url.includes('/notebook/label-view'));

            if (!targetTab || typeof targetTab.id !== 'number') {
                throw new Error('Label view notebook tab was not found.');
            }

            return chrome.tabs.sendMessage(targetTab.id, { type: 'SWITCH_SOURCE_VIEW', viewKind: 'label' });
        });
        await expect(notebookPage.locator('[data-testid="source-label-group"]').first()).toBeVisible();

        await expect.poll(async () => notebookPage.evaluate(() => {
            const root = document.querySelector('#sources-plus-root')?.shadowRoot || null;
            const container = root?.querySelector('.sp-container') || null;
            const list = root?.querySelector('#sources-list') || null;
            const searchCluster = root?.querySelector('.sp-search-cluster') || null;
            const newGroupButton = root?.querySelector('#sp-new-group-btn') || null;
            const resizer = root?.querySelector('.sp-resizer') || null;

            if (!root || !container || !list || !searchCluster || !newGroupButton || !resizer) {
                return null;
            }

            return {
                isNativeLabelView: container.classList.contains('is-native-label-view'),
                containerHeight: Math.round(container.getBoundingClientRect().height),
                inlineHeight: container.style.height,
                managerSourceRows: root.querySelectorAll('#sources-list .source-item').length,
                resizerDisplay: window.getComputedStyle(resizer).display,
                sourceListDisplay: window.getComputedStyle(list).display,
                searchDisplay: window.getComputedStyle(searchCluster).display,
                newGroupDisplay: window.getComputedStyle(newGroupButton).display,
                nativeLabelGroups: document.querySelectorAll('[data-testid="source-label-group"]').length,
                nativeSourceTitles: Array.from(document.querySelectorAll('[data-testid="source-label-group"] [data-testid="source-title"]'))
                    .map((node) => node.textContent.trim())
            };
        }), { timeout: 20_000 }).toEqual({
            isNativeLabelView: true,
            containerHeight: expect.any(Number),
            inlineHeight: '',
            managerSourceRows: 0,
            resizerDisplay: 'flex',
            sourceListDisplay: 'none',
            searchDisplay: 'none',
            newGroupDisplay: 'none',
            nativeLabelGroups: 2,
            nativeSourceTitles: [
                'Notebook label-view source A',
                'Notebook label-view source B'
            ]
        });
        await expect.poll(async () => notebookPage.evaluate(() => {
            const root = document.querySelector('#sources-plus-root')?.shadowRoot || null;
            const container = root?.querySelector('.sp-container') || null;
            return Math.round(container?.getBoundingClientRect().height || 0);
        }), { timeout: 20_000 }).toBeLessThan(180);

        const status = await bridgePage.evaluate(async () => {
            const tabs = await chrome.tabs.query({ url: 'https://notebooklm.google.com/*' });
            const targetTab = tabs.find((tab) => tab.url && tab.url.includes('/notebook/label-view'));

            if (!targetTab || typeof targetTab.id !== 'number') {
                throw new Error('Label view notebook tab was not found.');
            }

            return chrome.tabs.sendMessage(targetTab.id, { type: 'GET_MANAGER_STATUS' });
        });

        expect(status).toMatchObject({ ready: true, reason: 'ready' });
    });

    test('shows an import preview message when native label import has no visible source rows', async () => {
        const notebookPage = await env.context.newPage();

        await notebookPage.goto('https://notebooklm.google.com/notebook/label-empty?fixture=label-empty');
        env.extensionId = await waitForExtensionId(env.context, env.userDataDir, repoRoot);

        await expect(notebookPage.locator('#sources-plus-root')).toBeVisible({ timeout: 20_000 });
        await sendNotebookMessage('/notebook/label-empty', { type: 'SWITCH_SOURCE_VIEW', viewKind: 'label' });
        await expect(notebookPage.locator('[data-testid="source-label-group"]').first()).toBeVisible();
        await expect(notebookPage.locator('#sp-import-native-labels-btn')).toBeEnabled();

        await notebookPage.locator('#sp-import-native-labels-btn').click();

        await expect(notebookPage.locator('#sp-native-label-import-modal')).toBeVisible({ timeout: 5_000 });
        await expect(notebookPage.locator('#sp-native-label-import-modal-title')).toBeVisible();
        await expect(notebookPage.locator('.sp-native-label-import-empty')).toBeVisible();
        await expect(notebookPage.locator('.sp-native-label-import-confirm-btn')).toBeDisabled();
    });

    test('previews native label import and shows imported plugin folders after switching back to list view', async () => {
        const notebookPage = await env.context.newPage();

        await notebookPage.goto('https://notebooklm.google.com/notebook/label-import?fixture=label-collapsed');
        env.extensionId = await waitForExtensionId(env.context, env.userDataDir, repoRoot);

        await expect(notebookPage.locator('#sources-plus-root')).toBeVisible({ timeout: 20_000 });
        await sendNotebookMessage('/notebook/label-import', { type: 'SWITCH_SOURCE_VIEW', viewKind: 'label' });
        await expect(notebookPage.locator('#sp-import-native-labels-btn')).toBeVisible({ timeout: 20_000 });
        await notebookPage.locator('#sp-import-native-labels-btn').click();

        await expect(notebookPage.locator('#sp-native-label-import-modal')).toBeVisible({ timeout: 5_000 });
        await expect(notebookPage.locator('#sp-native-label-import-modal')).toContainText('Research papers');
        await expect(notebookPage.locator('#sp-native-label-import-modal')).toContainText('Reference material');

        await notebookPage.locator('.sp-native-label-import-confirm-btn').click();

        await expect.poll(async () => notebookPage.evaluate(() => {
            const root = document.querySelector('#sources-plus-root')?.shadowRoot || null;
            return root?.querySelector('.sp-view-banner-meta')?.textContent?.trim() || '';
        }), { timeout: 5_000 }).toContain('2');

        await notebookPage.evaluate(() => {
            window.__swapNotebook({
                notebookId: 'label-import',
                labelView: false
            });
        });
        await sendNotebookMessage('/notebook/label-import', { type: 'SWITCH_SOURCE_VIEW', viewKind: 'list' });

        await expect.poll(async () => notebookPage.evaluate(() => {
            const root = document.querySelector('#sources-plus-root')?.shadowRoot || null;
            const container = root?.querySelector('.sp-container') || null;
            const list = root?.querySelector('#sources-list') || null;
            const nativeScroll = document.querySelector('[data-testid="scroll-area"]');
            return {
                isNativeLabelView: Boolean(container?.classList.contains('is-native-label-view')),
                listText: list?.textContent || '',
                nativeScrollVisibility: nativeScroll ? window.getComputedStyle(nativeScroll).visibility : ''
            };
        }), { timeout: 20_000 }).toMatchObject({
            isNativeLabelView: false,
            listText: expect.stringContaining('Research papers'),
            nativeScrollVisibility: 'hidden'
        });
        await expect.poll(async () => notebookPage.evaluate(() => {
            const root = document.querySelector('#sources-plus-root')?.shadowRoot || null;
            return root?.querySelector('#sources-list')?.textContent || '';
        }), { timeout: 5_000 }).toContain('Reference material');
    });

    test('disables and re-enables the manager from the popup controls', async () => {
        const notebookPage = await env.context.newPage();

        await notebookPage.goto('https://notebooklm.google.com/notebook/toggle');
        env.extensionId = await waitForExtensionId(env.context, env.userDataDir, repoRoot);
        const popupPage = await openExtensionPage(env.context, env.extensionId, 'src/popup/popup.html');

        await expect(notebookPage.locator('#sources-plus-root')).toBeVisible({ timeout: 20_000 });

        const notebookTabId = await popupPage.evaluate(async () => {
            const tabs = await chrome.tabs.query({ url: 'https://notebooklm.google.com/*' });
            const targetTab = tabs.find((tab) => tab.url && tab.url.includes('/notebook/toggle'));

            if (!targetTab || typeof targetTab.id !== 'number') {
                throw new Error('Toggle notebook tab was not found.');
            }

            await chrome.tabs.update(targetTab.id, { active: true });
            return targetTab.id;
        });

        await popupPage.reload();
        await popupPage.waitForLoadState('domcontentloaded');

        const softToggleMarker = await notebookPage.evaluate(() => {
            window.__softToggleMarker = `marker-${Date.now()}-${Math.random()}`;
            return window.__softToggleMarker;
        });

        await popupPage.locator('.popup-switch').click();

        await expect.poll(async () => popupPage.locator('#popup-toggle-input').isChecked()).toBe(false);
        await expect(notebookPage.locator('#sources-plus-root')).toHaveCount(0, { timeout: 20_000 });
        await expect(notebookPage.locator('[data-testid="source-title"]').first()).toBeVisible({ timeout: 20_000 });
        await expect(notebookPage.locator('[data-testid="source-title"]').first()).toHaveText('Notebook toggle source A');
        await expect.poll(async () => notebookPage.evaluate(() => window.__softToggleMarker || null)).toBe(softToggleMarker);

        const disabledStatus = await popupPage.evaluate(async (tabId) => {
            return chrome.tabs.sendMessage(tabId, { type: 'GET_MANAGER_STATUS' });
        }, notebookTabId);

        expect(disabledStatus).toEqual({ ready: false, reason: 'extension_disabled' });

        await popupPage.locator('#popup-primary-btn').click();

        await expect.poll(async () => popupPage.locator('#popup-toggle-input').isChecked()).toBe(true);
        await expect(notebookPage.locator('#sources-plus-root')).toBeVisible({ timeout: 20_000 });
        await expect.poll(async () => notebookPage.evaluate(() => window.__softToggleMarker || null)).toBe(softToggleMarker);

        const enabledStatus = await popupPage.evaluate(async (tabId) => {
            return chrome.tabs.sendMessage(tabId, { type: 'GET_MANAGER_STATUS' });
        }, notebookTabId);

        expect(enabledStatus).toMatchObject({ ready: true, reason: 'ready' });
    });

    test('reattaches after a same-tab notebook route switch', async () => {
        const notebookPage = await env.context.newPage();

        await notebookPage.goto('https://notebooklm.google.com/notebook/a');
        env.extensionId = await waitForExtensionId(env.context, env.userDataDir, repoRoot);
        const bridgePage = await openExtensionPage(env.context, env.extensionId, 'src/popup/popup.html');

        await expect(notebookPage.locator('#sources-plus-root')).toBeVisible({ timeout: 20_000 });
        await expect(notebookPage.locator('[data-testid="source-title"]').first()).toHaveText('Notebook a source A');

        const navigationCountBefore = await notebookPage.evaluate(() => performance.getEntriesByType('navigation').length);

        await notebookPage.evaluate((nextSources) => {
            window.__swapNotebook({
                notebookId: 'b',
                sources: nextSources
            });
        }, defaultSourcesForNotebook('b'));

        await expect(notebookPage.locator('[data-testid="source-title"]').first()).toHaveText('Notebook b source A', { timeout: 20_000 });
        await expect(notebookPage.locator('#sources-plus-root')).toBeVisible();

        const status = await bridgePage.evaluate(async () => {
            const tabs = await chrome.tabs.query({ url: 'https://notebooklm.google.com/*' });
            const targetTab = tabs.find((tab) => tab.url && tab.url.includes('/notebook/b'));

            if (!targetTab || typeof targetTab.id !== 'number') {
                throw new Error('Swapped notebook tab was not found.');
            }

            return chrome.tabs.sendMessage(targetTab.id, { type: 'GET_MANAGER_STATUS' });
        });

        const navigationCountAfter = await notebookPage.evaluate(() => performance.getEntriesByType('navigation').length);

        expect(status).toMatchObject({ ready: true, reason: 'ready' });
        expect(navigationCountAfter).toBe(navigationCountBefore);
    });

    test('renders hostile source metadata as text and blocks third-party source icons', async () => {
        const notebookPage = await env.context.newPage();

        await notebookPage.goto('https://notebooklm.google.com/notebook/hostile-source?fixture=malicious-icons');
        await waitForExtensionId(env.context, env.userDataDir, repoRoot);
        await expect(notebookPage.locator('#sources-plus-root')).toBeVisible({ timeout: 20_000 });

        await expect.poll(async () => notebookPage.evaluate(() => {
            const root = document.querySelector('#sources-plus-root')?.shadowRoot || null;
            return {
                titleExecuted: Boolean(window.__sourceTitleXss),
                literalTitle: root?.querySelector('.source-title-text')?.textContent || '',
                untrustedImages: Array.from(root?.querySelectorAll('img.source-icon-image') || [])
                    .map((image) => image.getAttribute('src') || '')
                    .filter((src) => src.includes('evil.example'))
            };
        }), { timeout: 10_000 }).toEqual({
            titleExecuted: false,
            literalTitle: '<img src=x onerror="window.__sourceTitleXss=1">',
            untrustedImages: []
        });
    });

    test('reattaches after leaving a notebook for home and opening another notebook', async () => {
        const notebookPage = await env.context.newPage();

        await notebookPage.goto('https://notebooklm.google.com/notebook/a');
        env.extensionId = await waitForExtensionId(env.context, env.userDataDir, repoRoot);
        const bridgePage = await openExtensionPage(env.context, env.extensionId, 'src/popup/popup.html');

        await expect(notebookPage.locator('#sources-plus-root')).toBeVisible({ timeout: 20_000 });

        const navigationCountBefore = await notebookPage.evaluate(() => performance.getEntriesByType('navigation').length);

        await notebookPage.evaluate(() => {
            history.pushState({}, '', '/');
            document.title = 'NotebookLM Home';
            document.body.innerHTML = '<main class="home-shell">NotebookLM Home</main>';
        });

        await expect(notebookPage.locator('#sources-plus-root')).toHaveCount(0);

        await notebookPage.evaluate((nextSources) => {
            window.__swapNotebook({
                notebookId: 'b',
                sources: nextSources
            });
        }, defaultSourcesForNotebook('b'));

        await expect(notebookPage.locator('[data-testid="source-title"]').first()).toHaveText('Notebook b source A', { timeout: 20_000 });
        await expect(notebookPage.locator('#sources-plus-root')).toBeVisible();

        const status = await bridgePage.evaluate(async () => {
            const tabs = await chrome.tabs.query({ url: 'https://notebooklm.google.com/*' });
            const targetTab = tabs.find((tab) => tab.url && tab.url.includes('/notebook/b'));

            if (!targetTab || typeof targetTab.id !== 'number') {
                throw new Error('Reopened notebook tab was not found.');
            }

            return chrome.tabs.sendMessage(targetTab.id, { type: 'GET_MANAGER_STATUS' });
        });

        const navigationCountAfter = await notebookPage.evaluate(() => performance.getEntriesByType('navigation').length);

        expect(status).toMatchObject({ ready: true, reason: 'ready' });
        expect(navigationCountAfter).toBe(navigationCountBefore);
    });

    test('preserves folders and tags across a hard reload with staged source hydration', async () => {
        const notebookPage = await env.context.newPage();
        await notebookPage.goto('https://notebooklm.google.com/notebook/persist?fixture=staged');
        env.extensionId = await waitForExtensionId(env.context, env.userDataDir, repoRoot);
        const bridgePage = await openExtensionPage(env.context, env.extensionId, 'src/popup/popup.html');

        await expect(notebookPage.locator('#sources-plus-root')).toBeVisible({ timeout: 20_000 });
        await notebookPage.evaluate(() => window.__waitForFixtureHydration('full'));
        await expect(notebookPage.locator('[data-testid="source-title"]').first()).toHaveText('Notebook persist source A', { timeout: 20_000 });

        const configuredState = await notebookPage.evaluate(async () => {
            await window.__waitForFixtureHydration('full');

            const getRoot = () => document.querySelector('#sources-plus-root')?.shadowRoot || null;
            const waitForValue = async (readValue, errorMessage, timeoutMs = 5_000) => {
                const start = Date.now();
                while ((Date.now() - start) < timeoutMs) {
                    const value = readValue();
                    if (value) {
                        return value;
                    }
                    await new Promise((resolve) => window.setTimeout(resolve, 25));
                }
                throw new Error(errorMessage);
            };
            const waitForRoot = () => waitForValue(getRoot, 'Manager root missing.');
            const waitForSelector = async (selector, errorMessage, timeoutMs = 5_000) => {
                return waitForValue(() => getRoot()?.querySelector(selector) || null, errorMessage, timeoutMs);
            };
            const clickSelector = async (selector, errorMessage, timeoutMs = 5_000) => {
                const target = await waitForSelector(selector, errorMessage, timeoutMs);
                target.click();
                return target;
            };
            const root = await waitForRoot();

            await clickSelector('#sp-new-group-btn', 'New group button missing.');

            const groupNameInput = await waitForSelector(
                '.sp-inline-group-name-input',
                'New group name input missing.'
            );
            const groupContainer = groupNameInput.closest('.group-container');
            const groupId = groupContainer?.dataset.groupId;
            if (!groupId) {
                throw new Error('New group container is missing data-group-id.');
            }
            groupNameInput.value = 'Persistence group';
            groupNameInput.dispatchEvent(new Event('input', { bubbles: true }));
            groupNameInput.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Enter',
                bubbles: true,
                cancelable: true
            }));

            const groupTitleNode = await waitForValue(() => {
                const titleNode = getRoot()?.querySelector(
                    `.group-container[data-group-id="${groupId}"] .group-title`
                );
                return titleNode?.textContent?.trim() === 'Persistence group'
                    ? titleNode
                    : null;
            }, 'Confirmed group title missing.');
            const sourceTitleNode = await waitForSelector('.source-item .source-title-text', 'Initial source title missing.');

            const sourceTitle = sourceTitleNode.textContent?.trim();
            const groupTitle = groupTitleNode.textContent?.trim();
            if (!groupTitle || !sourceTitle) {
                throw new Error('Initial group or source title missing.');
            }

            await clickSelector('.source-item .sp-source-actions-button', 'Source actions button missing.');
            await clickSelector('.sp-source-actions-menu-item[data-action="move"]', 'Move action missing.');
            await clickSelector('.sp-folder-option', 'Folder option missing.');

            await clickSelector('#sp-manage-tags-btn', 'Manage tags button missing.');
            const tagInput = await waitForSelector('#sp-tag-name-input', 'Tag modal input missing.');
            tagInput.value = 'Pinned';
            tagInput.dispatchEvent(new Event('input', { bubbles: true }));
            await clickSelector('#sp-create-tag-btn', 'Create tag button missing.');
            await clickSelector('#sp-tag-backdrop', 'Tag modal backdrop missing.');

            await clickSelector('.source-item .sp-source-actions-button', 'Source actions button missing after tag creation.');
            await clickSelector('.sp-source-actions-menu-item[data-action="tags"]', 'Tags action missing.');
            const firstTagCheckbox = await waitForSelector('.sp-tag-option-checkbox', 'Source tag checkbox missing.');
            firstTagCheckbox.click();
            await clickSelector('#sp-save-tags-btn', 'Save tags button missing.');
            const tagPill = await waitForSelector('.sp-tag-pill', 'Assigned tag pill missing.');

            return {
                groupTitle,
                sourceTitle,
                tagLabel: tagPill.textContent?.trim() || null
            };
        });

        expect(configuredState.tagLabel).toBe('Pinned');

        await expect.poll(async () => {
            const stored = await readProjectState('persist', bridgePage);
            return Object.keys(stored.primary?.sourceTagsById || {}).length;
        }, { timeout: 10_000 }).toBeGreaterThan(0);

        const storedBeforeReload = await readProjectState('persist', bridgePage);
        expect(storedBeforeReload.primary?.groupsById).toBeTruthy();
        expect(Object.values(storedBeforeReload.primary.groupsById)).toHaveLength(1);
        expect(storedBeforeReload.primary.sourceTagsById).toBeTruthy();

        await notebookPage.reload();
        await expect(notebookPage.locator('#sources-plus-root')).toBeVisible({ timeout: 20_000 });
        await notebookPage.evaluate(() => window.__waitForFixtureHydration('full'));

        await expect.poll(async () => notebookPage.evaluate(() => {
            const root = document.querySelector('#sources-plus-root')?.shadowRoot;
            if (!root) return null;
            return {
                groups: Array.from(root.querySelectorAll('.group-title')).map((node) => node.textContent.trim()),
                groupedSources: Array.from(root.querySelectorAll('.group-container .source-title-text')).map((node) => node.textContent.trim()),
                tags: Array.from(root.querySelectorAll('.sp-tag-pill')).map((node) => node.textContent.trim())
            };
        }), { timeout: 20_000 }).toEqual({
            groups: [configuredState.groupTitle],
            groupedSources: [configuredState.sourceTitle],
            tags: ['Pinned']
        });

        const storedAfterReload = await readProjectState('persist', bridgePage);
        expect(storedAfterReload.primary).toEqual(storedBeforeReload.primary);
    });

    test('restores an import backup and preserves dragged source ordering after reload', async () => {
        // Root-level source reordering is a reflow-mode (Beta) feature; the default classic
        // mode demotes a loose source dropped at root to the bottom bin. Enable reflow before
        // the content script reads preferences on first load.
        const reflowSeedBridge = await openExtensionPage(env.context, env.extensionId, 'src/popup/popup.html');
        try {
            const reflowResp = await reflowSeedBridge.evaluate(async () => chrome.runtime.sendMessage({
                type: 'SAVE_PREFERENCES',
                preferences: { dragMode: 'reflow' }
            }));
            if (!reflowResp?.success) {
                throw new Error(`Failed to enable reflow drag mode: ${reflowResp?.errorCode || 'unknown_error'}`);
            }
        } finally {
            await reflowSeedBridge.close();
        }

        const notebookPage = await env.context.newPage();
        await notebookPage.goto('https://notebooklm.google.com/notebook/import-sort');
        env.extensionId = await waitForExtensionId(env.context, env.userDataDir, repoRoot);
        const bridgePage = await openExtensionPage(env.context, env.extensionId, 'src/popup/popup.html');

        await expect(notebookPage.locator('#sources-plus-root')).toBeVisible({ timeout: 20_000 });
        await notebookPage.evaluate(() => window.__waitForFixtureHydration('full'));

        const restoredOrder = await notebookPage.evaluate(async () => {
            const getRoot = () => document.querySelector('#sources-plus-root')?.shadowRoot || null;
            const waitForValue = async (readValue, errorMessage, timeoutMs = 5_000) => {
                const start = Date.now();
                while ((Date.now() - start) < timeoutMs) {
                    const value = readValue();
                    if (value) return value;
                    await new Promise((resolve) => window.setTimeout(resolve, 25));
                }
                throw new Error(errorMessage);
            };
            const waitForRoot = () => waitForValue(getRoot, 'Manager root missing.');
            const waitForSelector = (selector, errorMessage, timeoutMs = 5_000) => (
                waitForValue(() => getRoot()?.querySelector(selector) || null, errorMessage, timeoutMs)
            );
            const clickSelector = async (selector, errorMessage, timeoutMs = 5_000) => {
                const target = await waitForSelector(selector, errorMessage, timeoutMs);
                target.click();
                return target;
            };
            const clickRestoreImportToastAction = async () => {
                const action = await waitForValue(() => {
                    const toastAction = getRoot()?.querySelector('.sp-toast.show .sp-toast-action');
                    const label = toastAction?.textContent?.trim().toLowerCase() || '';
                    return toastAction && !['undo', '撤销', 'deshacer'].includes(label) ? toastAction : null;
                }, 'Restore previous state toast action missing.', 8_000);
                action.click();
                return action;
            };
            const readSourceTitles = () => Array.from(getRoot()?.querySelectorAll('.source-item .source-title-text') || [])
                .map((node) => node.textContent?.trim())
                .filter(Boolean);
            const waitForFirstTitle = async (expectedTitle) => waitForValue(() => {
                const titles = readSourceTitles();
                return titles[0] === expectedTitle ? titles : null;
            }, `Expected first source title ${expectedTitle}.`);
            const dragFirstSourceAfterSecond = async () => {
                const rows = Array.from(getRoot()?.querySelectorAll('.source-item') || []);
                if (rows.length < 2) throw new Error('Expected at least two source rows.');

                const dataTransfer = new DataTransfer();
                rows[0].dispatchEvent(new DragEvent('dragstart', {
                    bubbles: true,
                    cancelable: true,
                    dataTransfer
                }));

                const targetRect = rows[1].getBoundingClientRect();
                rows[1].dispatchEvent(new DragEvent('dragover', {
                    bubbles: true,
                    cancelable: true,
                    dataTransfer,
                    clientY: targetRect.bottom - 1
                }));
                rows[1].dispatchEvent(new DragEvent('drop', {
                    bubbles: true,
                    cancelable: true,
                    dataTransfer
                }));
                rows[0].dispatchEvent(new DragEvent('dragend', {
                    bubbles: true,
                    cancelable: true,
                    dataTransfer
                }));
            };

            await waitForRoot();
            const initialOrder = readSourceTitles();
            if (initialOrder.length < 2) throw new Error('Expected at least two sources.');

            await dragFirstSourceAfterSecond();
            const movedOrder = await waitForFirstTitle(initialOrder[1]);

            await clickSelector('#sp-settings-btn', 'Settings button missing.');
            await clickSelector('.sp-settings-import-section .sp-settings-collapsible-toggle', 'Import configuration toggle missing.');

            const previewImportText = async (text) => {
                const importTextarea = await waitForSelector('.sp-settings-import-textarea', 'Import textarea missing.');
                importTextarea.value = text;
                importTextarea.dispatchEvent(new Event('input', { bubbles: true }));
                await clickSelector('.sp-settings-preview-import-btn', 'Preview import button missing.');
            };

            await previewImportText(JSON.stringify({
                format: 'notebooklm-source-management-config',
                formatVersion: 1,
                data: {
                    schemaVersion: 3,
                    groups: ['cycle-a'],
                    groupsById: {
                        'cycle-a': {
                            id: 'cycle-a',
                            title: 'Cycle A',
                            children: [{ type: 'group', id: 'cycle-b' }]
                        },
                        'cycle-b': {
                            id: 'cycle-b',
                            title: 'Cycle B',
                            children: [{ type: 'group', id: 'cycle-a' }]
                        }
                    },
                    ungrouped: [],
                    sourceStateById: {},
                    customHeight: null,
                    tagsById: {},
                    tagOrder: [],
                    sourceTagsById: {}
                }
            }));
            await waitForValue(() => {
                const root = getRoot();
                const preview = root?.querySelector('.sp-settings-import-preview.is-invalid');
                const applyButton = root?.querySelector('.sp-settings-apply-import-btn');
                return preview && (!applyButton || applyButton.disabled) ? true : null;
            }, 'Cyclic import preview was not rejected.');

            await previewImportText(JSON.stringify({
                format: 'notebooklm-source-management-config',
                formatVersion: 1,
                data: {
                    schemaVersion: 3,
                    groups: ['imported-smoke-group'],
                    groupsById: {
                        'imported-smoke-group': {
                            id: 'imported-smoke-group',
                            title: 'Imported smoke group',
                            children: []
                        }
                    },
                    ungrouped: [],
                    sourceStateById: {},
                    customHeight: null,
                    tagsById: {},
                    tagOrder: [],
                    sourceTagsById: {}
                }
            }));
            await clickSelector('.sp-settings-apply-import-btn', 'Apply import button missing.');
            await clickRestoreImportToastAction();

            return waitForFirstTitle(movedOrder[0]);
        });

        expect(restoredOrder[0]).toBe('Notebook import-sort source B');
        expect(restoredOrder[1]).toBe('Notebook import-sort source A');

        await expect.poll(async () => {
            const stored = await readProjectState('import-sort', bridgePage);
            return stored.primary?.ungrouped?.[0] || '';
        }, { timeout: 10_000 }).toContain('import-sort-source-b');

        await notebookPage.reload();
        await expect(notebookPage.locator('#sources-plus-root')).toBeVisible({ timeout: 20_000 });
        await notebookPage.evaluate(() => window.__waitForFixtureHydration('full'));

        await expect.poll(async () => notebookPage.evaluate(() => {
            const root = document.querySelector('#sources-plus-root')?.shadowRoot;
            return Array.from(root?.querySelectorAll('.source-item .source-title-text') || [])
                .map((node) => node.textContent.trim());
        }), { timeout: 20_000 }).toEqual([
            'Notebook import-sort source B',
            'Notebook import-sort source A'
        ]);
    });

    test('classic drag mode (default) shows the blue insertion line and never folds the dragged row', async () => {
        // No reflow seed → the default classic mode is active.
        const notebookPage = await env.context.newPage();
        await notebookPage.goto('https://notebooklm.google.com/notebook/import-sort');
        env.extensionId = await waitForExtensionId(env.context, env.userDataDir, repoRoot);

        await expect(notebookPage.locator('#sources-plus-root')).toBeVisible({ timeout: 20_000 });
        await notebookPage.evaluate(() => window.__waitForFixtureHydration('full'));

        const result = await notebookPage.evaluate(async () => {
            const getRoot = () => document.querySelector('#sources-plus-root')?.shadowRoot || null;
            const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
            const rows = () => Array.from(getRoot()?.querySelectorAll('.source-item') || []);
            let current = rows();
            for (let i = 0; i < 80 && current.length < 2; i += 1) { await sleep(25); current = rows(); }
            if (current.length < 2) throw new Error('Expected at least two source rows.');

            const dataTransfer = new DataTransfer();
            current[0].dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
            await sleep(40); // give the (reflow-only) rAF-deferred fold a chance to run
            const foldedAfterStart = getRoot().querySelectorAll('.sp-drag-folded').length;
            const draggingAfterStart = getRoot().querySelectorAll('.dragging').length;

            const targetRect = current[1].getBoundingClientRect();
            current[1].dispatchEvent(new DragEvent('dragover', {
                bubbles: true, cancelable: true, dataTransfer, clientY: targetRect.bottom - 1
            }));
            await sleep(40); // dragover rAF
            const blueLines = getRoot().querySelectorAll('.drag-over-top, .drag-over-bottom').length;
            const guideBars = getRoot().querySelectorAll('.sp-drag-guide').length;

            current[0].dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer }));
            return { foldedAfterStart, draggingAfterStart, blueLines, guideBars };
        });

        // Classic: the dragged row is dimmed (.dragging) but never folded away, and feedback
        // is the blue insertion line — not the reflow fold / guide bar.
        expect(result.draggingAfterStart).toBeGreaterThan(0);
        expect(result.foldedAfterStart).toBe(0);
        expect(result.guideBars).toBe(0);
        expect(result.blueLines).toBeGreaterThan(0);
    });

    test('rejects stale saves without overwriting newer storage state', async () => {
        const notebookPage = await env.context.newPage();
        await notebookPage.goto('https://notebooklm.google.com/notebook/stale-save');
        env.extensionId = await waitForExtensionId(env.context, env.userDataDir, repoRoot);
        const bridgePage = await openExtensionPage(env.context, env.extensionId, 'src/popup/popup.html');

        await expect(notebookPage.locator('#sources-plus-root')).toBeVisible({ timeout: 20_000 });
        await notebookPage.evaluate(() => window.__waitForFixtureHydration('full'));

        const protectedState = {
            schemaVersion: 3,
            groups: ['protected-group'],
            groupsById: {
                'protected-group': {
                    id: 'protected-group',
                    title: 'Protected group',
                    children: []
                }
            },
            ungrouped: [],
            sourceStateById: {},
            customHeight: null,
            tagsById: {},
            tagOrder: [],
            sourceTagsById: {},
            _saveRevision: 10,
            _savedAt: '2026-04-22T00:00:00.000Z'
        };

        await bridgePage.evaluate(async ({ projectId, state }) => {
            const key = `sourcesPlusState_${projectId}`;
            await new Promise((resolve) => {
                chrome.storage.local.set({
                    [key]: state,
                    [`${key}__backup`]: state
                }, resolve);
            });
        }, { projectId: 'stale-save', state: protectedState });

        await notebookPage.evaluate(async () => {
            const getRoot = () => document.querySelector('#sources-plus-root')?.shadowRoot || null;
            const start = Date.now();
            let clickedNewGroup = false;
            while ((Date.now() - start) < 5_000) {
                const button = getRoot()?.querySelector('#sp-new-group-btn');
                if (button) {
                    button.click();
                    clickedNewGroup = true;
                    break;
                }
                await new Promise((resolve) => window.setTimeout(resolve, 25));
            }
            if (!clickedNewGroup) {
                throw new Error('New group button missing.');
            }

            const inputStart = Date.now();
            let groupNameInput = null;
            while ((Date.now() - inputStart) < 5_000) {
                groupNameInput = getRoot()?.querySelector('.sp-inline-group-name-input') || null;
                if (groupNameInput) break;
                await new Promise((resolve) => window.setTimeout(resolve, 25));
            }
            if (!groupNameInput) {
                throw new Error('New group name input missing.');
            }

            groupNameInput.value = 'Stale save attempt';
            groupNameInput.dispatchEvent(new Event('input', { bubbles: true }));
            groupNameInput.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Enter',
                bubbles: true,
                cancelable: true
            }));
        });

        await expect.poll(async () => {
            const stored = await readProjectState('stale-save', bridgePage);
            return stored.primary?._saveRevision || 0;
        }, { timeout: 5_000 }).toBe(10);

        const storedAfterStaleSave = await readProjectState('stale-save', bridgePage);
        expect(storedAfterStaleSave.primary).toEqual(protectedState);
        expect(storedAfterStaleSave.backup).toEqual(protectedState);
    });

    test('post-drop hover refresh: pseudo-hover lands on cursor row, not the dragstart row', async () => {
        // Regression guard: Chrome's native :hover freezes during HTML5 drag and
        // stays on the dragstart element after drop until a real mousemove fires.
        // Because patchChildren re-uses DOM nodes in place, the dragstart node now
        // displays a different source post-drop, so the user sees the "wrong" row
        // highlighted. handleDragEnd compensates by adding .sp-drag-active on
        // #sources-list (suppression CSS) + .sp-pseudo-hover on the cursor-under
        // row, and tears down only on a trusted pointer event.
        const notebookPage = await env.context.newPage();
        await notebookPage.goto('https://notebooklm.google.com/notebook/hover-refresh');

        await expect(notebookPage.locator('#sources-plus-root')).toBeVisible({ timeout: 20_000 });
        await notebookPage.evaluate(() => window.__waitForFixtureHydration('full'));

        const dropOutcome = await notebookPage.evaluate(async () => {
            const getRoot = () => document.querySelector('#sources-plus-root')?.shadowRoot || null;
            const waitForValue = async (readValue, errorMessage, timeoutMs = 5_000) => {
                const start = Date.now();
                while ((Date.now() - start) < timeoutMs) {
                    const value = readValue();
                    if (value) return value;
                    await new Promise((resolve) => window.setTimeout(resolve, 25));
                }
                throw new Error(errorMessage);
            };
            await waitForValue(getRoot, 'Manager root missing.');
            const rows = await waitForValue(() => {
                const list = Array.from(getRoot()?.querySelectorAll('.source-item') || []);
                return list.length >= 2 ? list : null;
            }, 'Need at least two source rows.');

            const fromRow = rows[0];
            const targetRow = rows[1];
            const targetRect = targetRow.getBoundingClientRect();
            const cursorX = Math.floor(targetRect.left + targetRect.width / 2);
            const cursorY = Math.floor(targetRect.top + targetRect.height / 2);

            const dataTransfer = new DataTransfer();
            fromRow.dispatchEvent(new DragEvent('dragstart', {
                bubbles: true, cancelable: true, dataTransfer
            }));
            targetRow.dispatchEvent(new DragEvent('dragover', {
                bubbles: true, cancelable: true, dataTransfer,
                clientX: cursorX, clientY: targetRect.bottom - 1
            }));
            targetRow.dispatchEvent(new DragEvent('drop', {
                bubbles: true, cancelable: true, dataTransfer,
                clientX: cursorX, clientY: cursorY
            }));
            // dragend MUST carry clientX/clientY — handleDragEnd's hover-refresh
            // path is guarded on both being numbers.
            fromRow.dispatchEvent(new DragEvent('dragend', {
                bubbles: true, cancelable: true, dataTransfer,
                clientX: cursorX, clientY: cursorY
            }));

            const root = getRoot();
            const sourcesList = root?.getElementById('sources-list') || null;
            const pseudoHoverRows = Array.from(root?.querySelectorAll('.sp-pseudo-hover') || []);
            return {
                hasDragActive: Boolean(sourcesList?.classList?.contains('sp-drag-active')),
                pseudoHoverCount: pseudoHoverRows.length,
                cursorX,
                cursorY
            };
        });

        // Immediately after dragend (no real mousemove yet): the suppression
        // class and at least one pseudo-hover row must be present.
        expect(dropOutcome.hasDragActive).toBe(true);
        expect(dropOutcome.pseudoHoverCount).toBeGreaterThanOrEqual(1);

        // A real (isTrusted=true) mousemove must tear both classes down so
        // native :hover takes over again.
        await notebookPage.mouse.move(dropOutcome.cursorX + 4, dropOutcome.cursorY + 4);
        await expect.poll(async () => notebookPage.evaluate(() => {
            const root = document.querySelector('#sources-plus-root')?.shadowRoot || null;
            if (!root) return null;
            const list = root.getElementById('sources-list');
            return {
                hasDragActive: Boolean(list?.classList?.contains('sp-drag-active')),
                pseudoHoverCount: root.querySelectorAll('.sp-pseudo-hover').length
            };
        }), { timeout: 5_000 }).toEqual({ hasDragActive: false, pseudoHoverCount: 0 });
    });
});
