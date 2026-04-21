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

    async function resolveExtensionIdAfterBootstrap(targetPath = '/notebook/bootstrap') {
        const bootstrapPage = await env.context.newPage();
        await bootstrapPage.goto(`https://notebooklm.google.com${targetPath}`);
        env.extensionId = await waitForExtensionId(env.context, env.userDataDir, repoRoot);
        await bootstrapPage.close();
    }

    test.beforeEach(async () => {
        env = await launchExtensionContext(repoRoot);
        await installNotebookFixture(env.context);
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

    test('injects the manager and handles the message bridge on the notebook fixture', async () => {
        const pageErrors = [];
        const notebookPage = await env.context.newPage();

        notebookPage.on('pageerror', (error) => pageErrors.push(error));
        notebookPage.on('console', (message) => {
            if (message.type() === 'error') {
                pageErrors.push(new Error(message.text()));
            }
        });

        await notebookPage.goto('https://notebooklm.google.com/notebook/a');
        env.extensionId = await waitForExtensionId(env.context, env.userDataDir, repoRoot);
        const bridgePage = await openExtensionPage(env.context, env.extensionId, 'src/popup/popup.html');

        await expect(notebookPage.locator('#sources-plus-root')).toBeVisible({ timeout: 20_000 });
        await expect(notebookPage.locator('[data-testid="source-panel"]')).toBeVisible();

        const status = await bridgePage.evaluate(async () => {
            const tabs = await chrome.tabs.query({ url: 'https://notebooklm.google.com/*' });
            const targetTab = tabs.find((tab) => tab.url && tab.url.includes('/notebook/a'));

            if (!targetTab || typeof targetTab.id !== 'number') {
                throw new Error('Notebook tab was not found.');
            }

            return chrome.tabs.sendMessage(targetTab.id, { type: 'GET_MANAGER_STATUS' });
        });

        expect(status).toEqual({ ready: true, reason: 'ready' });

        const focusResult = await bridgePage.evaluate(async () => {
            const tabs = await chrome.tabs.query({ url: 'https://notebooklm.google.com/*' });
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

        expect(enabledStatus).toEqual({ ready: true, reason: 'ready' });
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

        expect(status).toEqual({ ready: true, reason: 'ready' });
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

            const groupTitleNode = await waitForSelector('.group-title', 'Initial group title missing.');
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
});
