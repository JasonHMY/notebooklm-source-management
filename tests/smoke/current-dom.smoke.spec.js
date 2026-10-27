const fs = require('fs');
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
const REAL_DOM_CAPTURE_PATH = path.join(repoRoot, 'tests/fixtures/real-dom/2026-10-27-notebook.google.com.html');
const CURRENT_DOM_URL = 'https://notebook.google.com/notebook/current-dom?fixture=current-dom';
const FAKE_TITLES = ['Fake Source 1', 'Fake Source 2', 'Fake Source 3'];

// Fresh browser context per test, so the tests are independent of each other.
test.describe('current Gemini Notebook DOM (2026-10)', () => {
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
                welcomeOnboardingSeenVersion: 1,
                whatsNewSeenVersion: manifest.version
            });
            if (!response?.success) {
                throw new Error(`Failed to seed smoke preferences: ${response?.errorCode || 'unknown_error'}`);
            }
        } finally {
            await bridgePage.close();
        }
    }

    function readManagerTitles(page) {
        return page.evaluate(() => {
            const root = document.querySelector('#sources-plus-root')?.shadowRoot;
            return Array.from(root?.querySelectorAll('#sources-list .source-item') || [])
                .map((item) => item.querySelector('.source-title-text')?.textContent?.trim() || '');
        });
    }

    function readNativeListVisibility(page) {
        return page.evaluate(() => {
            const list = document.querySelector('.scroll-area-desktop');
            return {
                markerActive: document.documentElement.classList.contains('sources-plus-manager-active'),
                visibility: list ? getComputedStyle(list).visibility : null
            };
        });
    }

    function readNativeClicks(page) {
        return page.evaluate(() => ({ ...window.__fixtureClicks }));
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

    test('mounts the manager and lists every row of the current DOM without touching native controls', async () => {
        const page = await env.context.newPage();
        await page.goto(CURRENT_DOM_URL);

        await expect(page.locator('#sources-plus-root')).toBeVisible({ timeout: 20_000 });
        await expect(page.locator('#sources-list .source-item')).toHaveCount(FAKE_TITLES.length);
        await expect.poll(() => readManagerTitles(page)).toEqual(expect.arrayContaining(FAKE_TITLES));

        const nativeClicks = await readNativeClicks(page);
        expect(nativeClicks.autoLabel).toBe(0);
        expect(nativeClicks.sort).toBe(0);
        expect(nativeClicks.selectAll).toBe(0);
        expect(nativeClicks.rowMore).toBe(0);
        expect(nativeClicks.rowButton).toBe(0);
    });

    test('picks up rows that render after mount and hides the native list once they are parsed', async () => {
        const page = await env.context.newPage();
        await page.goto(`${CURRENT_DOM_URL}&rows=deferred`);
        await expect(page.locator('.cover-subtitle-source-count')).toHaveText(`${FAKE_TITLES.length} sources`);
        await expect(page.locator('#sources-plus-root')).toBeVisible({ timeout: 20_000 });
        expect(await readManagerTitles(page)).toEqual([]);

        expect(await page.evaluate(() => window.__fixtureRenderRows())).toBe(FAKE_TITLES.length);

        await expect(page.locator('#sources-list .source-item')).toHaveCount(FAKE_TITLES.length, { timeout: 20_000 });
        await expect.poll(() => readNativeListVisibility(page)).toEqual({ markerActive: true, visibility: 'hidden' });
        expect((await readNativeClicks(page)).autoLabel).toBe(0);
    });

    // Known gap, tracked as audit finding E1/A1: the manager hides the native list as soon as it mounts,
    // even when no row has been parsed yet. Remove .fixme once the hide waits for parsed rows.
    test.fixme('keeps the native list visible while no row has been parsed', async () => {
        const page = await env.context.newPage();
        await page.goto(`${CURRENT_DOM_URL}&rows=deferred`);
        await expect(page.locator('#sources-plus-root')).toBeVisible({ timeout: 20_000 });
        await page.waitForTimeout(1500);

        expect(await readNativeListVisibility(page)).toEqual({ markerActive: false, visibility: 'visible' });
    });

    test('toggling a source in the manager reaches the native checkbox', async () => {
        const page = await env.context.newPage();
        await page.goto(CURRENT_DOM_URL);
        await expect(page.locator('#sources-list .source-item')).toHaveCount(FAKE_TITLES.length, { timeout: 20_000 });

        const readNativeChecked = () => page.evaluate(() => (
            Array.from(document.querySelectorAll('.single-source-container input[type="checkbox"]'))
                .map((input) => input.checked)
        ));
        expect(await readNativeChecked()).toEqual([true, true, true]);

        await page.locator('#sources-list .source-item .sp-checkbox').first().click();

        await expect.poll(readNativeChecked, { timeout: 10_000 }).toEqual([false, true, true]);
        const nativeClicks = await readNativeClicks(page);
        expect(nativeClicks.autoLabel).toBe(0);
        expect(nativeClicks.selectAll).toBe(0);
        expect(nativeClicks.rowMore).toBe(0);
    });

    test('folder switch and source checkbox toggles save once without a false failure toast', async () => {
        const page = await env.context.newPage();
        await page.goto(CURRENT_DOM_URL);
        await expect(page.locator('#sources-list .source-item')).toHaveCount(FAKE_TITLES.length, { timeout: 20_000 });
        const bridgePage = await openExtensionPage(env.context, env.extensionId, 'src/popup/popup.html');

        // Count error toasts as they appear: one that shows and hides between two assertions must not be missed.
        await page.evaluate(() => {
            window.__errorToasts = 0;
            const root = document.querySelector('#sources-plus-root').shadowRoot;
            new MutationObserver((records) => {
                records.forEach((record) => record.addedNodes.forEach((node) => {
                    if (node.nodeType === 1 && (node.matches('.sp-toast-error') || node.querySelector('.sp-toast-error'))) {
                        window.__errorToasts += 1;
                    }
                }));
            }).observe(root, { childList: true, subtree: true });
        });
        const readStored = () => bridgePage.evaluate(async () => {
            const key = 'sourcesPlusState_current-dom';
            const stored = (await chrome.storage.local.get(key))[key];
            if (!stored) return null;
            return {
                folders: Object.values(stored.groupsById || {}).map((group) => group.enabled),
                sources: Object.fromEntries(
                    Object.values(stored.sourceStateById || {}).map((record) => [record.title, record.enabled])
                )
            };
        });
        const readNativeChecked = () => page.evaluate(() => Object.fromEntries(
            Array.from(document.querySelectorAll('.single-source-container')).map((container) => [
                container.textContent.match(/Fake Source \d/)?.[0],
                container.querySelector('input[type="checkbox"]').checked
            ])
        ));
        const sourceCheckbox = (title) => page.locator('#sources-list .source-item', { hasText: title }).locator('.sp-checkbox');

        await page.locator('#sp-new-group-btn').click();
        const nameInput = page.locator('.sp-inline-group-name-input');
        await nameInput.fill('Toggle folder');
        await nameInput.press('Enter');
        const folder = page.locator('.group-container', { hasText: 'Toggle folder' });
        await expect(folder.locator('.group-title').first()).toHaveText('Toggle folder');
        await page.locator('#sources-list .source-item', { hasText: FAKE_TITLES[0] }).locator('.sp-source-actions-button').click();
        await page.locator('.sp-source-actions-menu-item[data-action="move"]').click();
        await page.locator('.sp-folder-option').filter({ hasText: 'Toggle folder' }).click();
        await expect(folder.locator('.source-item')).toHaveCount(1);

        // A real click on the switch fires click and change on the same input.
        await folder.locator('.sp-toggle-switch').first().click();
        await expect(folder.locator('.sp-group-toggle-checkbox')).not.toBeChecked();
        await expect(folder.locator('.badge').first()).toHaveText(/0\s*\/\s*1/);
        await expect.poll(readNativeChecked, { timeout: 10_000 }).toEqual({
            'Fake Source 1': false, 'Fake Source 2': true, 'Fake Source 3': true
        });
        await expect.poll(async () => (await readStored())?.folders).toEqual([false]);

        await folder.locator('.sp-toggle-switch').first().click();
        await expect(folder.locator('.sp-group-toggle-checkbox')).toBeChecked();
        await expect(folder.locator('.badge').first()).toHaveText(/1\s*\/\s*1/);
        await expect.poll(readNativeChecked, { timeout: 10_000 }).toEqual({
            'Fake Source 1': true, 'Fake Source 2': true, 'Fake Source 3': true
        });
        await expect.poll(async () => (await readStored())?.folders).toEqual([true]);

        // Mouse click, then keyboard Space (browsers synthesize a click for it) on source checkboxes.
        await sourceCheckbox(FAKE_TITLES[1]).click();
        await expect(sourceCheckbox(FAKE_TITLES[1])).not.toBeChecked();
        await sourceCheckbox(FAKE_TITLES[2]).focus();
        await page.keyboard.press('Space');
        await expect(sourceCheckbox(FAKE_TITLES[2])).not.toBeChecked();
        await expect.poll(readNativeChecked, { timeout: 10_000 }).toEqual({
            'Fake Source 1': true, 'Fake Source 2': false, 'Fake Source 3': false
        });
        await expect.poll(async () => (await readStored())?.sources).toMatchObject({
            'Fake Source 1': true, 'Fake Source 2': false, 'Fake Source 3': false
        });

        // The false failure toast shows up shortly after the commit, so give it time before asserting.
        await page.waitForTimeout(500);
        expect(await page.evaluate(() => window.__errorToasts)).toBe(0);
        await expect(page.locator('.sp-toast-error')).toHaveCount(0);

        await page.reload();
        await expect(page.locator('#sources-list .source-item')).toHaveCount(FAKE_TITLES.length, { timeout: 20_000 });
        await expect(page.locator('.group-container', { hasText: 'Toggle folder' }).locator('.sp-group-toggle-checkbox')).toBeChecked();
        await expect(sourceCheckbox(FAKE_TITLES[0])).toBeChecked();
        await expect(sourceCheckbox(FAKE_TITLES[1])).not.toBeChecked();
        await expect(sourceCheckbox(FAKE_TITLES[2])).not.toBeChecked();
        await expect.poll(readNativeChecked, { timeout: 10_000 }).toEqual({
            'Fake Source 1': true, 'Fake Source 2': false, 'Fake Source 3': false
        });
        await bridgePage.close();
    });

    test('deletes one source through the native menu using the header count as evidence', async () => {
        const page = await env.context.newPage();
        await page.goto(CURRENT_DOM_URL);
        await expect(page.locator('#sources-list .source-item')).toHaveCount(FAKE_TITLES.length, { timeout: 20_000 });
        await expect(page.locator('.cover-subtitle-source-count')).toHaveText('3 sources');

        await page.locator('.sp-source-actions-button').first().click();
        await page.locator('.sp-source-actions-menu [data-action="delete-source"]').click();
        await expect(page.getByRole('alertdialog')).toBeVisible();
        await page.locator('.sp-batch-delete-confirm-final-btn').click();

        await expect(page.locator('.single-source-container')).toHaveCount(FAKE_TITLES.length - 1, { timeout: 20_000 });
        await expect(page.locator('.cover-subtitle-source-count')).toHaveText('2 sources');
        await expect.poll(() => readManagerTitles(page), { timeout: 20_000 }).toEqual(FAKE_TITLES.slice(1));

        const nativeClicks = await readNativeClicks(page);
        expect(nativeClicks.deleted).toBe(1);
        expect(nativeClicks.rowMore).toBe(1);
        expect(nativeClicks.autoLabel).toBe(0);
        expect(nativeClicks.sort).toBe(0);
        expect(nativeClicks.selectAll).toBe(0);
    });

    test.describe('real-DOM capture', () => {
        test('mounts on the sanitized 2026-10-27 capture without clicking the auto-label button', async () => {
            const capture = fs.readFileSync(REAL_DOM_CAPTURE_PATH, 'utf8');
            const page = await env.context.newPage();
            await page.route('https://notebook.google.com/notebook/real-dom', async (route) => {
                await route.fulfill({
                    status: 200,
                    contentType: 'text/html',
                    body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Notebook real-dom</title></head><body>${capture}</body></html>`
                });
            });
            await page.addInitScript(() => {
                window.__autoLabelClicks = 0;
                document.addEventListener('click', (event) => {
                    if (event.target instanceof Element && event.target.closest('.label-auto-button')) {
                        window.__autoLabelClicks += 1;
                    }
                }, true);
            });
            await page.goto('https://notebook.google.com/notebook/real-dom');

            await expect(page.locator('#sources-plus-root')).toBeVisible({ timeout: 20_000 });
            await expect(page.locator('#sources-list .source-item')).toHaveCount(FAKE_TITLES.length);
            await expect.poll(() => readManagerTitles(page)).toEqual(expect.arrayContaining(FAKE_TITLES));
            await expect.poll(() => readNativeListVisibility(page)).toEqual({ markerActive: true, visibility: 'hidden' });
            expect(await page.evaluate(() => window.__autoLabelClicks)).toBe(0);
        });

        test('real detectors read rows, controls and identity from the capture', async () => {
            const capture = fs.readFileSync(REAL_DOM_CAPTURE_PATH, 'utf8');
            // about:blank is not a content-script match, so the modules below are the only ones running.
            const page = await env.context.newPage();
            await page.setContent(`<!doctype html><html lang="en"><body>${capture}</body></html>`);
            await page.evaluate(() => { window.getMessage = (key) => key; });
            for (const relativePath of [
                'src/utils/storage-contract.js',
                'src/content/content-config.js',
                'src/content/source-descriptor-helpers.js',
                'src/content/content-panel-dom.js',
                'src/content/content-tree-placement.js',
                'src/content/content-native-label-detector.js',
                'src/content/content-source-sync.js'
            ]) {
                await page.addScriptTag({ content: fs.readFileSync(path.join(repoRoot, relativePath), 'utf8') });
            }

            const report = await page.evaluate(() => {
                const config = globalThis.NSM_CONTENT_CONFIG;
                const helpers = globalThis.NSM_SOURCE_DESCRIPTOR_HELPERS;
                const runtime = {};
                const panelDom = globalThis.NSM_CREATE_CONTENT_PANEL_DOM({
                    runtime,
                    DEPS: config.DEPS,
                    SCROLL_AREA_SELECTOR: config.SCROLL_AREA_SELECTOR
                });
                const sync = globalThis.NSM_CREATE_CONTENT_SOURCE_SYNC({
                    runtime,
                    treePlacement: globalThis.NSM_CREATE_CONTENT_TREE_PLACEMENT({
                        getState: () => ({}),
                        getGroupsById: () => new Map()
                    }),
                    findSourcePanel: panelDom.findSourcePanel,
                    isSourcePanelRenderable: panelDom.isSourcePanelRenderable,
                    isManageableSourceIdentity: helpers.isManageableSourceIdentity,
                    extractSourceIdentitySnapshot: helpers.extractSourceIdentitySnapshot,
                    normalizeSourceText: helpers.normalizeSourceText
                });

                const panel = panelDom.findSourcePanel();
                const entries = sync.getSourceEntries(panel);
                const seenSourceIds = new Map();
                const rows = entries.map(({ row }) => {
                    const identity = helpers.extractSourceIdentitySnapshot(row);
                    const descriptor = helpers.createSourceDescriptor(row, seenSourceIds, new Map());
                    return {
                        title: identity.title,
                        checkboxAriaLabel: identity.checkbox?.getAttribute('aria-label') || null,
                        moreAriaLabel: identity.nativeMoreButton?.getAttribute('aria-label') || null,
                        moreIsAutoLabel: Boolean(identity.nativeMoreButton?.classList.contains('label-auto-button')),
                        moreInsideRow: Boolean(identity.nativeMoreButton && row.contains(identity.nativeMoreButton)),
                        moreIconText: identity.nativeMoreButton?.querySelector('mat-icon')?.textContent.trim() || null,
                        iconText: identity.iconEl?.textContent.trim() || null,
                        iconName: identity.iconName,
                        stableToken: identity.stableToken,
                        identityType: descriptor.identityType,
                        key: descriptor.key,
                        hasNativeActionMenu: descriptor.hasNativeActionMenu
                    };
                });

                const headerControls = {
                    autoLabel: document.querySelector('.label-auto-button'),
                    sort: document.querySelector('.source-sort-button'),
                    selectAll: document.querySelector('.select-checkbox-all-sources')
                };
                const headerControlReport = Object.fromEntries(Object.entries(headerControls).map(([name, element]) => [
                    name,
                    {
                        found: Boolean(element),
                        insideRow: entries.some(({ row }) => row.contains(element)),
                        isRow: entries.some(({ row }) => row === element),
                        matchesRowMoreSelector: config.DEPS.moreBtn.some((selector) => element.matches(selector))
                    }
                ]));

                const firstPanelWideMore = panel.querySelector(config.DEPS.moreBtn[0]);
                return {
                    panelClass: panel?.className || null,
                    contentClass: panelDom.findSourcePanelContent(panel)?.className || null,
                    rows,
                    headerControls: headerControlReport,
                    firstPanelWideMoreAriaLabel: firstPanelWideMore?.getAttribute('aria-label') || null,
                    firstPanelWideMoreIsAutoLabel: Boolean(firstPanelWideMore?.classList.contains('label-auto-button')),
                    viewKind: sync.getSourceViewInfo(panel).kind,
                    panelState: sync.getSourcePanelState(panel),
                    headerCountText: document.querySelector('.cover-subtitle-source-count')?.textContent || null
                };
            });

            expect(report.panelClass).toContain('source-panel');
            expect(report.contentClass).toContain('scroll-area-desktop');
            expect(report.rows).toHaveLength(3);
            report.rows.forEach((row, index) => {
                const title = FAKE_TITLES[index];
                expect(row).toMatchObject({
                    title,
                    checkboxAriaLabel: `Select ${title}`,
                    moreAriaLabel: 'More',
                    moreIsAutoLabel: false,
                    moreInsideRow: true,
                    moreIconText: 'more_vert',
                    iconText: 'drive_pdf',
                    iconName: 'description',
                    stableToken: null,
                    identityType: 'fingerprint',
                    hasNativeActionMenu: true
                });
            });
            expect(new Set(report.rows.map((row) => row.key)).size).toBe(3);

            Object.values(report.headerControls).forEach((control) => {
                expect(control).toEqual({
                    found: true,
                    insideRow: false,
                    isRow: false,
                    matchesRowMoreSelector: false
                });
            });
            // A panel-wide query reaches the first matching button in document order. The auto-label
            // button comes before every row, so it must not match the row More button selector.
            expect(report.firstPanelWideMoreAriaLabel).toBe('More');
            expect(report.firstPanelWideMoreIsAutoLabel).toBe(false);

            expect(report.viewKind).toBe('list');
            expect(report.panelState).toMatchObject({ state: 'ready', totalRows: 3, manageableRows: 3 });
            expect(report.headerCountText).toContain('sources');
        });
    });
});
