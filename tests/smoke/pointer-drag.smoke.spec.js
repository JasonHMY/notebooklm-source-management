const path = require('path');
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const { launchExtensionContext, closeExtensionContext, waitForExtensionId, openExtensionPage } = require('./helpers/extension-context');
const { installNotebookFixture } = require('./helpers/notebooklm-fixture');

const repoRoot = path.resolve(__dirname, '../..');
const manifest = require('../../manifest.json');
const projectId = 'pointer-motion';
const previewDir = path.join(repoRoot, 'output', 'beui-drag-preview');

test.describe('beUI pointer presentation', () => {
    let env;
    let page;
    let bridge;

    const tree = () => bridge.evaluate(async (id) => {
        const state = (await chrome.storage.local.get(`sourcesPlusState_${id}`))[`sourcesPlusState_${id}`];
        return state ? { root: state.root, ungrouped: state.ungrouped, groupsById: state.groupsById } : null;
    }, projectId);
    const paint = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

    test.beforeEach(async () => {
        env = await launchExtensionContext(repoRoot);
        await installNotebookFixture(env.context, { resolveSources: () => Array.from({ length: 6 }, (_, index) => ({
            id: `pointer-${index}`, token: `pointer-${index}`, title: `Pointer source ${index}`
        })) });
        const id = await waitForExtensionId(env.context, env.userDataDir, repoRoot);
        bridge = await openExtensionPage(env.context, id, 'src/popup/popup.html');
        const prefs = await bridge.evaluate((version) => chrome.runtime.sendMessage({
            type: 'SAVE_PREFERENCES', preferences: { welcomeOnboardingSeenVersion: 1, whatsNewSeenVersion: version }
        }), manifest.version);
        expect(prefs.preferences.dragMode).toBe('reflow');
        page = await env.context.newPage();
        await page.goto(`https://notebook.google.com/notebook/${projectId}`);
        await expect(page.locator('#sources-list .source-item')).toHaveCount(6);
        // Initial source discovery is runtime-only. A real folder operation
        // supplies the durable baseline against which previews are compared.
        await page.locator('#sp-new-group-btn').click();
        await page.locator('.sp-inline-group-name-input').fill('Pointer folder');
        await page.locator('.sp-inline-group-name-input').press('Enter');
        await expect.poll(tree).not.toBeNull();
        await paint();
    });

    test.afterEach(async () => closeExtensionContext(env));

    test('uses only handles, follows the pointer and visibly springs siblings without persisting preview', async ({}, info) => {
        fs.mkdirSync(previewDir, { recursive: true });
        const before = await tree();
        const row = page.locator('#sources-list .source-item').first();
        const title = row.locator('.source-title-text');
        const titleBox = await title.boundingBox();
        await page.mouse.move(titleBox.x + 12, titleBox.y + titleBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(titleBox.x + 12, titleBox.y + 65, { steps: 6 });
        await page.mouse.up();
        await expect(page.locator('#sources-list.sp-drag-active')).toHaveCount(0);
        expect(await tree()).toEqual(before);

        const handle = row.locator('.sp-drag-handle');
        await handle.hover();
        await expect(row).toHaveCSS('transform', /matrix\(1\.01,/);
        const box = await handle.boundingBox();
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        await page.mouse.move(x, y);
        await page.screenshot({ path: path.join(previewDir, 'before.png') });
        await page.mouse.down();
        // Pointer preparation measures the pressed row, not its former hover
        // scale. Compare the ghost to that same settled visual state.
        await expect(row).toHaveCSS('transform', /matrix\(0\.995,/);
        const originBox = await row.boundingBox();
        await page.mouse.move(x, y + 8);
        await expect(page.locator('.sp-drag-pointer-ghost')).toHaveCount(1);
        await paint();
        const ghost = page.locator('.sp-drag-pointer-ghost');
        const ghostBox = await ghost.boundingBox();
        expect(Math.abs(ghostBox.x - originBox.x)).toBeLessThan(1);
        expect(Math.abs(ghostBox.y - originBox.y - 8)).toBeLessThan(1);
        const firstTop = ghostBox.y;
        await page.mouse.move(x, y + 98);
        await paint();
        expect(Math.abs((await ghost.boundingBox()).y - firstTop - 90)).toBeLessThan(1);
        const scale = await ghost.locator('.sp-drag-ghost-layer').first().evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).a);
        expect(scale).toBeCloseTo(1.025, 3);
        await expect(ghost.locator('.source-title-text')).toHaveText('Pointer source 0');
        await expect(ghost.locator('.source-item')).toHaveCSS('opacity', '1');

        const shifted = page.locator('#sources-list .source-item.sp-drop-shift').last();
        await expect(shifted).toBeVisible();
        const early = await shifted.evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).m42);
        expect(early).toBeGreaterThan(0);
        await expect.poll(() => shifted.evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).m42))
            .toBeGreaterThan(early + 0.5);
        await page.screenshot({ path: path.join(previewDir, 'dragging.png') });
        expect(await tree()).toEqual(before);
        await page.keyboard.press('Escape');
        await page.mouse.up();
        await expect(page.locator('.sp-drag-pointer-ghost')).toHaveCount(0);
        await expect(page.locator('#sources-list .sp-drag-folded')).toHaveCount(0);
        await expect(page.locator('#sources-list .sp-drop-shift')).toHaveCount(0);
        expect(await tree()).toEqual(before);
        await page.screenshot({ path: path.join(previewDir, 'cancelled.png') });
        for (const name of ['before', 'dragging', 'cancelled']) {
            await info.attach(name, { path: path.join(previewDir, `${name}.png`), contentType: 'image/png' });
        }
    });

    test('keeps Home/End keyboard order, focus, anonymous status and persistence aligned', async () => {
        const before = await tree();
        const keys = before.ungrouped;
        const handle = page.locator(`#sources-list .sp-drag-handle[data-source-key="${keys[0]}"]`);
        await handle.focus();
        await handle.press('End');
        await expect.poll(async () => (await tree()).ungrouped).toEqual([...keys.slice(1), keys[0]]);
        await expect(handle).toBeFocused();
        await expect(page.locator('#sp-tree-order-status')).toContainText('6');
        await expect(page.locator('#sp-tree-order-status')).not.toContainText('Pointer source');
        await handle.press('Home');
        await expect.poll(async () => (await tree()).ungrouped).toEqual(keys);
        await expect(handle).toBeFocused();
        await handle.press('ArrowDown');
        await expect.poll(async () => (await tree()).ungrouped).toEqual([keys[1], keys[0], ...keys.slice(2)]);
        await handle.press('ArrowUp');
        await expect.poll(async () => (await tree()).ungrouped).toEqual(keys);
        await page.reload();
        await expect(page.locator('#sources-list .source-item')).toHaveCount(6);
        expect(await tree()).toEqual(before);
    });

    test('settles a dropped row through the ghost and preserves explicitly selected Classic feedback', async () => {
        const before = await tree();
        const keys = before.ungrouped;
        const start = page.locator(`#sources-list .source-item[data-source-key="${keys[0]}"] .sp-drag-handle`);
        const box = await start.boundingBox();
        const destination = await page.locator('#sources-list .source-item').nth(2).boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 8);
        await page.mouse.move(box.x + box.width / 2, destination.y + destination.height - 2, { steps: 8 });
        await paint();
        await page.mouse.up();
        const landed = page.locator(`#sources-list .source-item[data-source-key="${keys[0]}"]`);
        if (await page.locator('.sp-drag-pointer-ghost').count()) {
            expect(await landed.evaluate((element) => element.style.opacity)).toBe('0');
        }
        await expect(page.locator('.sp-drag-pointer-ghost')).toHaveCount(0);
        await expect(landed).toHaveCSS('opacity', '1');
        const settled = await tree();
        expect(settled.ungrouped).not.toEqual(keys);
        await page.reload();
        await expect(page.locator('#sources-list .source-item')).toHaveCount(6);
        expect(await tree()).toEqual(settled);

        const response = await bridge.evaluate(() => chrome.runtime.sendMessage({
            type: 'SAVE_PREFERENCES', preferences: { dragMode: 'classic' }
        }));
        expect(response.preferences.dragMode).toBe('classic');
        await page.reload();
        await expect(page.locator('#sources-list .source-item')).toHaveCount(6);
        const handle = page.locator('#sources-list .source-item .sp-drag-handle').first();
        const source = await handle.boundingBox();
        const target = await page.locator('#sources-list .source-item').nth(2).boundingBox();
        await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
        await page.mouse.down();
        await page.mouse.move(source.x + source.width / 2, target.y + target.height - 3, { steps: 8 });
        await expect(page.locator('#sources-list .drag-over-top, #sources-list .drag-over-bottom')).toHaveCount(1);
        await expect(page.locator('#sources-list .sp-drag-folded')).toHaveCount(0);
        await page.keyboard.press('Escape');
        await page.mouse.up();
        expect(await tree()).toEqual(settled);
    });

    test('moves a folder and its complete subtree from the folder handle', async () => {
        const firstId = (await tree()).root[0].id;
        await page.locator('#sp-new-group-btn').click();
        await page.locator('.sp-inline-group-name-input').fill('Second folder');
        await page.locator('.sp-inline-group-name-input').press('Enter');
        await expect.poll(async () => (await tree()).root.length).toBe(2);
        const secondId = (await tree()).root[1].id;
        const sourceKey = (await tree()).ungrouped[0];
        const sourceHandle = page.locator(`#sources-list .source-item[data-source-key="${sourceKey}"] .sp-drag-handle`);
        const sourceBox = await sourceHandle.boundingBox();
        const second = page.locator(`#sources-list .group-container[data-group-id="${secondId}"]`);
        const secondHeader = await second.locator('.group-header').first().boundingBox();
        await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2 + 8);
        await page.mouse.move(secondHeader.x + secondHeader.width * 0.75, secondHeader.y + secondHeader.height / 2, { steps: 8 });
        await page.mouse.up();
        await expect.poll(async () => (await tree()).groupsById[secondId].children.some((entry) => entry.key === sourceKey)).toBe(true);
        await expect(page.locator('.sp-drag-pointer-ghost')).toHaveCount(0);
        for (const id of [firstId, secondId]) {
            const caret = page.locator(`#sources-list .group-container[data-group-id="${id}"] .sp-caret`).first();
            if (await caret.getAttribute('aria-expanded') !== 'false') await caret.click();
        }
        await expect.poll(async () => {
            const stored = await tree();
            return [firstId, secondId].every((id) => stored.groupsById[id].collapsed);
        }).toBe(true);
        await paint();
        const folderHandle = second.locator('.sp-drag-handle').first();
        const startBox = await folderHandle.boundingBox();
        const first = page.locator(`#sources-list .group-container[data-group-id="${firstId}"]`);
        await page.mouse.move(startBox.x + startBox.width / 2, startBox.y + startBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(startBox.x + startBox.width / 2, startBox.y + startBox.height / 2 + 8);
        await expect(second).toHaveClass(/sp-drag-folded/);
        await expect(page.locator('.sp-drag-pointer-ghost .group-title')).toHaveText('Second folder');
        await expect(page.locator('.sp-drag-pointer-ghost .source-item')).toHaveCount(0);
        const targetBox = await first.locator('.group-header').first().boundingBox();
        await page.mouse.move(targetBox.x + 6, targetBox.y + 3, { steps: 8 });
        await page.mouse.up();
        await expect.poll(async () => (await tree()).root.map((entry) => entry.id)).toEqual([secondId, firstId]);
        expect((await tree()).groupsById[secondId].children).toEqual([{ type: 'source', key: sourceKey }]);
    });
});
