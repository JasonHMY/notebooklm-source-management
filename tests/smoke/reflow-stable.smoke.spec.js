const path = require('path');
const { test, expect } = require('@playwright/test');
const {
    launchExtensionContext,
    closeExtensionContext,
    waitForExtensionId,
    openExtensionPage
} = require('./helpers/extension-context');
const { installNotebookFixture } = require('./helpers/notebooklm-fixture');

const repoRoot = path.resolve(__dirname, '../..');
const manifest = require('../../manifest.json');
const notebookId = 'reflow-stable';

async function createFolder(page, title) {
    await page.locator('#sp-new-group-btn').click();
    const input = page.locator('.sp-inline-group-name-input');
    const groupId = await input.evaluate((element) => element.closest('.group-container').dataset.groupId);
    await input.fill(title);
    await input.press('Enter');
    const folder = page.locator(`.group-container[data-group-id="${groupId}"]`);
    await expect(folder.locator('.group-title').first()).toHaveText(title);
    return groupId;
}

async function readTree(bridge) {
    return bridge.evaluate(async (id) => {
        const key = `sourcesPlusState_${id}`;
        const stored = (await chrome.storage.local.get(key))[key];
        if (!stored) return null;
        return {
            root: stored.root,
            ungrouped: stored.ungrouped,
            groupsById: stored.groupsById,
            sourceStateById: stored.sourceStateById,
            sourceTagsById: stored.sourceTagsById
        };
    }, notebookId);
}

async function collectTrustedEvents(page) {
    await page.evaluate(() => {
        window.__reflowTrustedEvents = [];
        const root = document.querySelector('#sources-plus-root').shadowRoot;
        for (const type of ['dragstart', 'dragover', 'drop', 'dragend']) {
            root.addEventListener(type, (event) => {
                window.__reflowTrustedEvents.push({
                    type,
                    trusted: event.isTrusted,
                    dropEffect: event.dataTransfer?.dropEffect || null,
                    defaultPrevented: event.defaultPrevented
                });
            });
        }
    });
}

async function startTrustedDrag(page, origin) {
    await collectTrustedEvents(page);
    await origin.scrollIntoViewIfNeeded();
    const box = await origin.boundingBox();
    expect(box).not.toBeNull();
    const x = box.x + box.width * 0.55;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 12, y + 12, { steps: 4 });
    await expect.poll(() => page.evaluate(() => window.__reflowTrustedEvents.some(
        (event) => event.type === 'dragstart' && event.trusted
    ))).toBe(true);
    await expect(page.locator('.sp-drag-folded').first()).toBeAttached();
    await expect.poll(() => origin.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThanOrEqual(1);
}

async function finishTrustedDrop(page, origin, target, position) {
    await collectTrustedEvents(page);
    const box = await target.boundingBox();
    expect(box).not.toBeNull();
    // Playwright's native drag action re-resolves the target after dragstart
    // and waits for its geometry to settle before releasing the mouse.
    await origin.dragTo(target, {
        targetPosition: { x: box.width * position.x, y: box.height * position.y }
    });
    await expect.poll(() => page.evaluate(() => window.__reflowTrustedEvents.some(
        (event) => event.type === 'dragstart' && event.trusted
    ))).toBe(true);
    await expect.poll(() => page.evaluate(() => window.__reflowTrustedEvents.some(
        (event) => event.type === 'drop' && event.trusted
    ))).toBe(true);
    await expect(page.locator('.sp-drag-folded')).toHaveCount(0);
}

test.describe.serial('stable reflow trusted drag', () => {
    let env;
    let bridge;
    let page;

    test.beforeEach(async () => {
        env = await launchExtensionContext(repoRoot);
        await installNotebookFixture(env.context, {
            resolveSources: () => Array.from({ length: 6 }, (_, index) => ({
                id: `reflow-source-${index + 1}`,
                token: `reflow-source-${index + 1}`,
                title: `Reflow source ${index + 1}`
            }))
        });
        const extensionId = await waitForExtensionId(env.context, env.userDataDir, repoRoot);
        bridge = await openExtensionPage(env.context, extensionId, 'src/popup/popup.html');
        const response = await bridge.evaluate((version) => chrome.runtime.sendMessage({
            type: 'SAVE_PREFERENCES',
            preferences: {
                dragMode: 'reflow',
                welcomeOnboardingSeenVersion: 1,
                whatsNewSeenVersion: version
            }
        }), manifest.version);
        expect(response.success).toBe(true);
        page = await env.context.newPage();
        await page.setViewportSize({ width: 1280, height: 1000 });
        await page.goto(`https://notebook.google.com/notebook/${notebookId}`);
        await expect(page.locator('#sources-list .source-item')).toHaveCount(6);
    });

    test.afterEach(async () => {
        if (env) await closeExtensionContext(env);
        env = null;
    });

    test('drops a source between collapsed folders and preserves exact placement through Undo, Redo, and reload', async () => {
        const alphaId = await createFolder(page, 'Alpha');
        const betaId = await createFolder(page, 'Beta');
        for (const groupId of [alphaId, betaId]) {
            const caret = page.locator(`.group-container[data-group-id="${groupId}"] .sp-caret`).first();
            if (await caret.getAttribute('aria-expanded') !== 'false') await caret.click();
        }
        await expect.poll(async () => {
            const saved = await readTree(bridge);
            return saved?.root?.length === 2 && [alphaId, betaId].every((id) => saved.groupsById[id]?.collapsed);
        }).toBe(true);
        // Storage acknowledges the collapsed state before its CSS transition
        // ends. Measure the drop target only after both folders stop moving.
        await expect.poll(() => page.evaluate(async (ids) => {
            const root = document.querySelector('#sources-plus-root').shadowRoot;
            const folders = ids.map((id) => root.querySelector(`.group-container[data-group-id="${id}"]`));
            const measure = () => folders.map((folder) => {
                const header = folder.querySelector('.group-header').getBoundingClientRect();
                return { top: header.top, height: folder.querySelector('.group-children').getBoundingClientRect().height };
            });
            const beforeFrame = measure();
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            return measure().every((rect, index) => rect.height <= 1 && Math.abs(rect.top - beforeFrame[index].top) < 0.25);
        }, [alphaId, betaId])).toBe(true);
        const before = await readTree(bridge);
        const source = page.locator('#sources-list .source-item').filter({ hasText: 'Reflow source 1' });
        const key = await source.getAttribute('data-source-key');
        const target = page.locator(`.group-container[data-group-id="${betaId}"] .group-header`).first();
        await finishTrustedDrop(page, source, target, { x: 0.25, y: 0.25 });
        const expectedRoot = [
            { type: 'group', id: alphaId },
            { type: 'source', key },
            { type: 'group', id: betaId }
        ];
        await expect.poll(async () => (await readTree(bridge))?.root).toEqual(expectedRoot);
        await expect(page.locator('#sources-list > .source-item')).toHaveAttribute('data-source-key', key);
        await page.locator('#sp-undo-btn').click();
        await expect.poll(() => readTree(bridge)).toEqual(before);
        await page.locator('#sp-redo-btn').click();
        await expect.poll(async () => (await readTree(bridge))?.root).toEqual(expectedRoot);
        const after = await readTree(bridge);
        await page.reload();
        await expect(page.locator('#sources-list > .source-item')).toHaveAttribute('data-source-key', key);
        await expect.poll(() => readTree(bridge)).toEqual(after);
    });

    test('moves a noncontiguous batch into a folder with a trusted drop and keeps every source exactly once', async () => {
        await page.emulateMedia({ colorScheme: 'dark' });
        const alphaId = await createFolder(page, 'Original Alpha');
        const betaId = await createFolder(page, 'Original Beta');
        const targetId = await createFolder(page, 'Batch destination');
        for (const [number, title] of [[1, 'Original Alpha'], [3, 'Original Beta']]) {
            const row = page.locator('#sources-list .source-item').filter({ hasText: `Reflow source ${number}` });
            await row.locator('.sp-source-actions-button').click();
            await page.locator('.sp-source-actions-menu-item[data-action="move"]').click();
            await page.locator('.sp-folder-option').filter({ hasText: title }).click();
        }
        await expect.poll(async () => {
            const saved = await readTree(bridge);
            return [alphaId, betaId].every((id) => saved?.groupsById?.[id]?.children?.length === 1);
        }).toBe(true);
        await page.locator('#sp-batch-action-btn').click();
        const selectedKeys = [];
        for (const number of [1, 3, 5]) {
            const row = page.locator('#sources-list .source-item').filter({ hasText: `Reflow source ${number}` });
            selectedKeys.push(await row.getAttribute('data-source-key'));
            await row.locator('.sp-batch-checkbox').check();
        }
        const origin = page.locator(`#sources-list .source-item[data-source-key="${selectedKeys[0]}"]`);
        const target = page.locator(`.group-container[data-group-id="${targetId}"] .group-header`).first();
        await finishTrustedDrop(page, origin, target, { x: 0.8, y: 0.5 });
        const expectedChildren = selectedKeys.map((key) => ({ type: 'source', key }));
        await expect.poll(async () => (await readTree(bridge))?.groupsById?.[targetId]?.children).toEqual(expectedChildren);
        await expect(page.locator('#sources-list .sp-batch-checkbox')).toHaveCount(0);
        const stored = await readTree(bridge);
        expect(stored.groupsById[alphaId].children).toEqual([]);
        expect(stored.groupsById[betaId].children).toEqual([]);
        const allKeys = [
            ...stored.ungrouped,
            ...Object.values(stored.groupsById).flatMap((group) => group.children.map((entry) => entry.key))
        ];
        expect(allKeys).toHaveLength(6);
        expect(new Set(allKeys).size).toBe(6);
        await page.reload();
        await expect(page.locator(`.group-container[data-group-id="${targetId}"] .source-item`)).toHaveCount(3);
        await expect.poll(() => readTree(bridge)).toEqual(stored);
    });

    test('cancels a trusted drag in a narrow reduced-motion panel without changing saved placement', async () => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.addStyleTag({ content: '[data-testid="source-panel"] { width: 240px; }' });
        await expect.poll(() => page.locator('#sources-plus-root').evaluate(
            (element) => element.getBoundingClientRect().width
        )).toBeLessThanOrEqual(240);
        await createFolder(page, 'Cancel destination');
        await expect.poll(async () => (await readTree(bridge))?.root?.length).toBe(1);
        const before = await readTree(bridge);
        const origin = page.locator('#sources-list .source-item').filter({ hasText: 'Reflow source 2' });
        await startTrustedDrag(page, origin);
        const target = await page.locator('.group-header').first().boundingBox();
        expect(target).not.toBeNull();
        await page.mouse.move(target.x + target.width * 0.8, target.y + target.height / 2, { steps: 12 });
        await page.keyboard.press('Escape');
        await page.mouse.up();
        await expect.poll(() => page.evaluate(() => window.__reflowTrustedEvents.some(
            (event) => event.type === 'dragend' && event.trusted
        ))).toBe(true);
        await expect(page.locator('.sp-drag-folded, .sp-drop-shift, .sp-drop-shift-static')).toHaveCount(0);
        expect(await readTree(bridge)).toEqual(before);
        await page.reload();
        await expect(page.locator('#sources-list .source-item')).toHaveCount(6);
        await expect.poll(() => readTree(bridge)).toEqual(before);
    });
});
