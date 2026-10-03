const path = require('path');

const { test, expect } = require('@playwright/test');

const {
    closeExtensionContext,
    launchExtensionContext,
    openExtensionPage,
    waitForExtensionId
} = require('./helpers/extension-context');
const { installNotebookFixture } = require('./helpers/notebooklm-fixture');

const repoRoot = path.resolve(__dirname, '../..');
const manifest = require('../../manifest.json');
const SMOKE_WELCOME_ONBOARDING_SEEN_VERSION = 1;
const SMOKE_WHATS_NEW_SEEN_VERSION = manifest.version;

test.describe.serial('batch drag smoke', () => {
    let env;

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

    test('moves three batch-selected sources into a folder via drag-and-drop', async () => {
        const sources = [
            { id: 'batch-drag-source-a', title: 'Batch source A', token: 'batch-drag-source-a' },
            { id: 'batch-drag-source-b', title: 'Batch source B', token: 'batch-drag-source-b' },
            { id: 'batch-drag-source-c', title: 'Batch source C', token: 'batch-drag-source-c' },
            { id: 'batch-drag-source-d', title: 'Batch source D', token: 'batch-drag-source-d' }
        ];
        const notebookPage = await env.context.newPage();
        await notebookPage.goto('https://notebooklm.google.com/notebook/batch-drag');
        env.extensionId = await waitForExtensionId(env.context, env.userDataDir, repoRoot);
        await expect(notebookPage.locator('#sources-plus-root')).toBeVisible({ timeout: 20_000 });

        await notebookPage.evaluate((nextSources) => {
            window.__swapNotebook({ notebookId: 'batch-drag', sources: nextSources });
        }, sources);

        // Wait for the manager to re-render with all four source rows present.
        await expect.poll(async () => notebookPage.evaluate(() => {
            const root = document.querySelector('#sources-plus-root')?.shadowRoot || null;
            return root ? root.querySelectorAll('#sources-list .source-item').length : 0;
        }), { timeout: 20_000 }).toBe(4);

        const result = await notebookPage.evaluate(async () => {
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
            const waitForSelector = (selector, errorMessage, timeoutMs = 5_000) => (
                waitForValue(() => getRoot()?.querySelector(selector) || null, errorMessage, timeoutMs)
            );
            const clickSelector = async (selector, errorMessage, timeoutMs = 5_000) => {
                const target = await waitForSelector(selector, errorMessage, timeoutMs);
                target.click();
                return target;
            };

            // Create a destination folder via the toolbar button.
            await clickSelector('#sp-new-group-btn', 'New group button missing.');
            const groupNameInput = await waitForSelector(
                '.sp-inline-group-name-input',
                'New group name input missing.'
            );
            const groupEl = groupNameInput.closest('.group-container');
            const groupId = groupEl?.dataset.groupId;
            if (!groupId) throw new Error('Group container is missing data-group-id.');
            groupNameInput.value = 'Batch drag destination';
            groupNameInput.dispatchEvent(new Event('input', { bubbles: true }));
            groupNameInput.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Enter',
                bubbles: true,
                cancelable: true
            }));
            await waitForValue(() => {
                const title = getRoot()?.querySelector(
                    `.group-container[data-group-id="${groupId}"] .group-title`
                );
                return title?.textContent?.trim() === 'Batch drag destination'
                    ? title
                    : null;
            }, 'Confirmed batch destination group missing.');

            // Enter batch mode via the toolbar.
            await clickSelector('#sp-batch-action-btn', 'Batch action button missing.');
            await waitForValue(
                () => getRoot()?.querySelector('.sp-batch-checkbox') ? true : null,
                'Batch checkboxes did not appear after enabling batch mode.'
            );

            // Tick three batch checkboxes (sources A, B, C).
            const checkboxes = Array.from(getRoot()?.querySelectorAll('.source-item .sp-batch-checkbox') || []);
            if (checkboxes.length < 3) throw new Error(`Expected >= 3 batch checkboxes, saw ${checkboxes.length}.`);
            checkboxes[0].click();
            checkboxes[1].click();
            checkboxes[2].click();

            await waitForValue(() => {
                const selected = getRoot()?.querySelectorAll('.source-item.selected-for-batch') || [];
                return selected.length === 3 ? selected : null;
            }, 'Three rows did not enter the selected-for-batch state.');

            const selectedRows = Array.from(getRoot()?.querySelectorAll('.source-item.selected-for-batch') || []);
            const selectedKeys = selectedRows.map((row) => row.dataset.sourceKey);
            const targetGroup = getRoot()?.querySelector(`.group-container[data-group-id="${groupId}"]`);
            if (!targetGroup) throw new Error('Target group container missing before drag.');

            return { groupId, selectedKeys };
        });

        expect(result.selectedKeys).toHaveLength(3);
        const handle = notebookPage.locator(
            `.source-item[data-source-key="${result.selectedKeys[0]}"] .sp-drag-handle`
        );
        const destination = notebookPage.locator(
            `.group-container[data-group-id="${result.groupId}"] .group-header`
        );
        await handle.scrollIntoViewIfNeeded();
        const handleBox = await handle.boundingBox();
        const targetBox = await destination.boundingBox();
        expect(handleBox).not.toBeNull();
        expect(targetBox).not.toBeNull();
        const startX = handleBox.x + handleBox.width / 2;
        const startY = handleBox.y + handleBox.height / 2;
        await notebookPage.mouse.move(startX, startY);
        await notebookPage.mouse.down();
        await notebookPage.mouse.move(startX + 8, startY + 8, { steps: 4 });
        await notebookPage.mouse.move(
            targetBox.x + targetBox.width * 0.75,
            targetBox.y + targetBox.height / 2,
            { steps: 12 }
        );
        await notebookPage.mouse.up();

        // The three sources should now sit inside the new group's children container.
        await expect.poll(async () => notebookPage.evaluate((groupId) => {
            const root = document.querySelector('#sources-plus-root')?.shadowRoot || null;
            if (!root) return null;
            const container = root.querySelector(`.group-container[data-group-id="${groupId}"]`);
            if (!container) return null;
            return Array.from(container.querySelectorAll('.group-children .source-item'))
                .map((row) => row.dataset.sourceKey)
                .filter(Boolean);
        }, result.groupId), { timeout: 10_000 }).toEqual(expect.arrayContaining(result.selectedKeys));

        // The success toast should reference the moved count (locale-agnostic match on "3").
        const toastText = await notebookPage.evaluate(async () => {
            const getRoot = () => document.querySelector('#sources-plus-root')?.shadowRoot || null;
            const start = Date.now();
            while ((Date.now() - start) < 10_000) {
                const toast = getRoot()?.querySelector('.sp-toast.show');
                const message = toast?.querySelector('.sp-toast-message')?.textContent?.trim();
                if (message) return message;
                await new Promise((resolve) => window.setTimeout(resolve, 25));
            }
            return null;
        });
        expect(toastText).toBeTruthy();
        expect(toastText).toMatch(/3/);

        // Batch mode should exit after a successful multi-source drop.
        await expect.poll(async () => notebookPage.evaluate(() => {
            const root = document.querySelector('#sources-plus-root')?.shadowRoot || null;
            return root ? root.querySelectorAll('.sp-batch-checkbox').length : null;
        }), { timeout: 5_000 }).toBe(0);
    });
});
