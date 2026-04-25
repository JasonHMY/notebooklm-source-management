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

    test('keeps NotebookLM label view visible in compact compatibility mode', async () => {
        const notebookPage = await env.context.newPage();

        await notebookPage.goto('https://notebooklm.google.com/notebook/label-view?fixture=label');
        env.extensionId = await waitForExtensionId(env.context, env.userDataDir, repoRoot);
        const bridgePage = await openExtensionPage(env.context, env.extensionId, 'src/popup/popup.html');

        await expect(notebookPage.locator('#sources-plus-root')).toBeVisible({ timeout: 20_000 });
        await expect(notebookPage.locator('[data-testid="source-label-group"]').first()).toBeVisible();

        await expect.poll(async () => notebookPage.evaluate(() => {
            const root = document.querySelector('#sources-plus-root')?.shadowRoot || null;
            const container = root?.querySelector('.sp-container') || null;
            const list = root?.querySelector('#sources-list') || null;
            const searchCluster = root?.querySelector('.sp-search-cluster') || null;
            const newGroupButton = root?.querySelector('#sp-new-group-btn') || null;

            if (!root || !container || !list || !searchCluster || !newGroupButton) {
                return null;
            }

            return {
                isNativeLabelView: container.classList.contains('is-native-label-view'),
                managerSourceRows: root.querySelectorAll('#sources-list .source-item').length,
                sourceListDisplay: window.getComputedStyle(list).display,
                searchDisplay: window.getComputedStyle(searchCluster).display,
                newGroupDisplay: window.getComputedStyle(newGroupButton).display,
                nativeLabelGroups: document.querySelectorAll('[data-testid="source-label-group"]').length,
                nativeSourceTitles: Array.from(document.querySelectorAll('[data-testid="source-label-group"] [data-testid="source-title"]'))
                    .map((node) => node.textContent.trim())
            };
        }), { timeout: 20_000 }).toEqual({
            isNativeLabelView: true,
            managerSourceRows: 0,
            sourceListDisplay: 'none',
            searchDisplay: 'none',
            newGroupDisplay: 'none',
            nativeLabelGroups: 2,
            nativeSourceTitles: [
                'Notebook label-view source A',
                'Notebook label-view source B'
            ]
        });

        const status = await bridgePage.evaluate(async () => {
            const tabs = await chrome.tabs.query({ url: 'https://notebooklm.google.com/*' });
            const targetTab = tabs.find((tab) => tab.url && tab.url.includes('/notebook/label-view'));

            if (!targetTab || typeof targetTab.id !== 'number') {
                throw new Error('Label view notebook tab was not found.');
            }

            return chrome.tabs.sendMessage(targetTab.id, { type: 'GET_MANAGER_STATUS' });
        });

        expect(status).toEqual({ ready: true, reason: 'ready' });
    });

    test('shows feedback when native label import has no visible source rows', async () => {
        const notebookPage = await env.context.newPage();

        await notebookPage.goto('https://notebooklm.google.com/notebook/label-empty?fixture=label-empty');
        env.extensionId = await waitForExtensionId(env.context, env.userDataDir, repoRoot);

        await expect(notebookPage.locator('#sources-plus-root')).toBeVisible({ timeout: 20_000 });
        await expect(notebookPage.locator('[data-testid="source-label-group"]').first()).toBeVisible();
        await expect(notebookPage.locator('#sp-import-native-labels-btn')).toBeEnabled();

        await notebookPage.locator('#sp-import-native-labels-btn').click();

        await expect.poll(async () => notebookPage.evaluate(() => {
            const root = document.querySelector('#sources-plus-root')?.shadowRoot || null;
            return root?.querySelector('.sp-toast.show .sp-toast-message')?.textContent?.trim() || '';
        }), { timeout: 5_000 }).toContain('NotebookLM');
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
            const importTextarea = await waitForSelector('.sp-settings-import-textarea', 'Import textarea missing.');
            importTextarea.value = JSON.stringify({
                format: 'notebooklm-source-management-config',
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
            });
            importTextarea.dispatchEvent(new Event('input', { bubbles: true }));
            await clickSelector('.sp-settings-preview-import-btn', 'Preview import button missing.');
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
            while ((Date.now() - start) < 5_000) {
                const button = getRoot()?.querySelector('#sp-new-group-btn');
                if (button) {
                    button.click();
                    return;
                }
                await new Promise((resolve) => window.setTimeout(resolve, 25));
            }
            throw new Error('New group button missing.');
        });

        await expect.poll(async () => {
            const stored = await readProjectState('stale-save', bridgePage);
            return stored.primary?._saveRevision || 0;
        }, { timeout: 5_000 }).toBe(10);

        const storedAfterStaleSave = await readProjectState('stale-save', bridgePage);
        expect(storedAfterStaleSave.primary).toEqual(protectedState);
        expect(storedAfterStaleSave.backup).toEqual(protectedState);
    });
});
