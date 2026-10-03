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
const windowedNotebookId = 'reflow-windowed';
const mixedWindowedNotebookId = 'mixed-windowed';
const fiftySelectionOrdinals = Array.from({ length: 50 }, (_, index) => 1 + index * 5);

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

async function readTree(bridge, projectId = notebookId) {
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
    }, projectId);
}

async function readStoredSnapshot(bridge, projectId) {
    return bridge.evaluate(async (id) => {
        const key = `sourcesPlusState_${id}`;
        return {
            key,
            value: (await chrome.storage.local.get(key))[key] || null
        };
    }, projectId);
}

async function writeIsolatedSnapshot(bridge, { key, value }) {
    const nextRevision = Math.max(0, Number(value?._saveRevision) || 0) + 1000;
    const snapshot = {
        ...value,
        _saveRevision: nextRevision,
        _savedAt: new Date().toISOString()
    };
    await bridge.evaluate(async ({ stateKey, next }) => {
        await chrome.storage.local.set({
            [stateKey]: next,
            [`${stateKey}__backup`]: next
        });
    }, { stateKey: key, next: snapshot });
}

async function collectTrustedEvents(page) {
    await page.evaluate(() => {
        window.__reflowTrustedEvents = [];
        const root = document.querySelector('#sources-plus-root').shadowRoot;
        const list = root.querySelector('#sources-list');
        const describeTarget = (target) => {
            const element = target instanceof Element ? target : null;
            const sourceRow = element?.closest?.('.source-item') || null;
            const groupHeader = element?.closest?.('.group-header') || null;
            return {
                tagName: element?.tagName || '',
                className: typeof element?.className === 'string' ? element.className : '',
                sourceKey: sourceRow?.dataset?.sourceKey || '',
                groupId: groupHeader?.dataset?.groupId || '',
                handle: Boolean(element?.closest?.('.sp-drag-handle')),
                handleDisabled: element?.closest?.('.sp-drag-handle')?.disabled ?? null,
                sourceDraggable: sourceRow?.draggable ?? null
            };
        };
        for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
            root.addEventListener(type, (event) => {
                window.__reflowTrustedEvents.push({
                    type,
                    trusted: event.isTrusted,
                    composed: event.composed,
                    clientX: Number(event.clientX) || 0,
                    clientY: Number(event.clientY) || 0,
                    defaultPrevented: event.defaultPrevented,
                    target: describeTarget(event.target)
                });
            });
        }
        list?.addEventListener('scroll', (event) => {
            window.__reflowTrustedEvents.push({
                type: 'scroll',
                trusted: event.isTrusted,
                scrollTop: list.scrollTop
            });
        }, { passive: true });
    });
}

async function readTrustedDragOriginPoint(origin) {
    return origin.evaluate((element) => {
        const handle = element.querySelector('.sp-drag-handle');
        const rect = handle?.getBoundingClientRect();
        if (!rect) return { usable: false };
        const root = element.getRootNode();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const target = (
            typeof root?.elementFromPoint === 'function'
                ? root.elementFromPoint(x, y)
                : document.elementFromPoint(x, y)
        );
        const sourceRow = target instanceof Element ? target.closest('.source-item') : null;
        return {
            x,
            y,
            relativeX: rect.width / 2,
            relativeY: rect.height / 2,
            sourceKey: sourceRow?.dataset?.sourceKey || '',
            usable: Boolean(
                rect.height > 1
                && sourceRow === element
                && target?.closest?.('.sp-drag-handle') === handle
                && !handle.disabled
            )
        };
    });
}

async function prepareTrustedDragOrigin(page, origin) {
    await origin.scrollIntoViewIfNeeded();
    const expectedSourceKey = await origin.getAttribute('data-source-key');
    expect(expectedSourceKey).toBeTruthy();
    const list = page.locator('#sources-list');
    for (let attempt = 0; attempt < 12; attempt += 1) {
        const point = await readTrustedDragOriginPoint(origin);
        if (point?.usable && point.sourceKey === expectedSourceKey) {
            await origin.locator('.sp-drag-handle').hover({
                position: { x: point.relativeX, y: point.relativeY }
            });
            const freshPoint = await readTrustedDragOriginPoint(origin);
            if (freshPoint?.usable && freshPoint.sourceKey === expectedSourceKey) {
                return freshPoint;
            }
        }
        const listBox = await list.boundingBox();
        expect(listBox).not.toBeNull();
        const beforeScrollTop = await list.evaluate((element) => element.scrollTop);
        await page.mouse.move(listBox.x + listBox.width / 2, listBox.y + listBox.height / 2);
        await page.mouse.wheel(0, 96);
        await expect.poll(() => list.evaluate((element) => element.scrollTop))
            .toBeGreaterThan(beforeScrollTop);
    }
    throw new Error('Could not expose a physical source-row drag origin.');
}

async function startTrustedDrag(page, origin, holdTarget = null) {
    await collectTrustedEvents(page);
    const startPoint = await prepareTrustedDragOrigin(page, origin);
    expect(startPoint).not.toBeNull();
    const { x, y } = startPoint;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 12, y + 12, { steps: 4 });
    await expect.poll(() => page.evaluate(() => window.__reflowTrustedEvents.some(
        (event) => event.type === 'pointerdown' && event.trusted && event.target.handle
    ))).toBe(true);
    await expect(page.locator('#sources-list.sp-drag-active')).toHaveCount(1);
    if (holdTarget) {
        const targetBox = await holdTarget.boundingBox();
        expect(targetBox).not.toBeNull();
        await page.mouse.move(
            targetBox.x + targetBox.width * 0.25,
            targetBox.y + targetBox.height / 2,
            { steps: 8 }
        );
        await expect.poll(() => page.evaluate(() => window.__reflowTrustedEvents.some(
            (event) => event.type === 'pointermove' && event.trusted && event.defaultPrevented
        ))).toBe(true);
    }
    await expect(page.locator('.sp-drag-folded').first()).toBeAttached();
    await expect.poll(() => origin.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThanOrEqual(1);
}

async function finishTrustedDrop(page, origin, target, position, { followTarget = false } = {}) {
    await startTrustedDrag(page, origin);
    if (!followTarget) {
        const box = await target.boundingBox();
        expect(box).not.toBeNull();
        await page.mouse.move(
            box.x + box.width * position.x,
            box.y + box.height * position.y,
            { steps: 12 }
        );
    } else {
        // Folding the selected rows and the spring gap can move a folder header
        // while a real pointer is crossing the list. Follow its live box until
        // it settles, then release inside the intended header.
        let landed = false;
        for (let attempt = 0; attempt < 24; attempt += 1) {
            const box = await target.boundingBox();
            expect(box).not.toBeNull();
            const x = box.x + box.width * position.x;
            const y = box.y + box.height * position.y;
            await page.mouse.move(x, y, { steps: attempt === 0 ? 12 : 3 });
            const current = await target.evaluate(async (element) => {
                const before = element.getBoundingClientRect();
                await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                const after = element.getBoundingClientRect();
                return {
                    left: after.left,
                    right: after.right,
                    top: after.top,
                    bottom: after.bottom,
                    moved: Math.abs(after.top - before.top) + Math.abs(after.left - before.left)
                };
            });
            const insetX = Math.min(4, (current.right - current.left) * 0.1);
            const insetY = Math.min(4, (current.bottom - current.top) * 0.1);
            if (current.moved < 0.25
                && x > current.left + insetX && x < current.right - insetX
                && y > current.top + insetY && y < current.bottom - insetY) {
                landed = true;
                break;
            }
        }
        expect(landed, 'The trusted pointer must release inside a settled drop target').toBe(true);
    }
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => window.__reflowTrustedEvents.some(
        (event) => event.type === 'pointerup' && event.trusted
    ))).toBe(true);
    await expect(page.locator('.sp-drag-folded')).toHaveCount(0);
}

async function getSourceWindowMetadata(page) {
    return page.evaluate(() => {
        const root = document.querySelector('#sources-plus-root')?.shadowRoot;
        const list = root?.querySelector('#sources-list');
        if (!list) return null;
        return {
            active: list.dataset.sourceWindowingActive === 'true',
            logicalSourceCount: Number(list.dataset.logicalSourceCount) || 0,
            start: Number(list.dataset.sourceWindowStart) || 0,
            end: Number(list.dataset.sourceWindowEnd) || 0,
            pinnedCount: Number(list.dataset.pinnedCount) || 0,
            materializedSources: Number(list.dataset.materializedSources) || 0,
            scrollTop: list.scrollTop,
            clientHeight: list.clientHeight,
            scrollHeight: list.scrollHeight
        };
    });
}

async function configureWindowedList(page) {
    await page.evaluate(() => {
        const root = document.querySelector('#sources-plus-root')?.shadowRoot;
        const list = root?.querySelector('#sources-list');
        if (!list) throw new Error('Windowed sources list is unavailable.');
        list.style.height = '250px';
        list.style.flex = 'none';
    });
    await expect.poll(() => getSourceWindowMetadata(page)).toMatchObject({
        active: true,
        logicalSourceCount: 260
    });
    await expect.poll(async () => {
        const metadata = await getSourceWindowMetadata(page);
        return Boolean(metadata && metadata.scrollHeight > metadata.clientHeight);
    }).toBe(true);
}

async function scrollWindowToOrdinal(page, ordinal, {
    allowFolded = false,
    diagnostics = null
} = {}) {
    for (let attempt = 0; attempt < 48; attempt += 1) {
        const metadata = await getSourceWindowMetadata(page);
        if (!metadata) throw new Error('Windowed sources list disappeared.');
        if (Array.isArray(diagnostics)) {
            diagnostics.push(await page.evaluate((targetOrdinal) => {
                const root = document.querySelector('#sources-plus-root')?.shadowRoot;
                const list = root?.querySelector('#sources-list');
                const target = root?.querySelector(
                    `.source-item[data-source-window-ordinal="${targetOrdinal}"]`
                );
                const listRect = list?.getBoundingClientRect();
                const targetRect = target?.getBoundingClientRect();
                const visibleSources = Array.from(root?.querySelectorAll('.source-item') || [])
                    .filter((row) => {
                        const rect = row.getBoundingClientRect();
                        return rect.height > 1 && rect.bottom > listRect?.top && rect.top < listRect?.bottom;
                    })
                    .map((row) => Number(row.dataset.sourceWindowOrdinal));
                return {
                    targetMounted: Boolean(target),
                    targetFolded: Boolean(target?.classList.contains('sp-drag-folded')),
                    targetRect: targetRect
                        ? { top: targetRect.top, bottom: targetRect.bottom, height: targetRect.height }
                        : null,
                    listRect: listRect
                        ? { top: listRect.top, bottom: listRect.bottom, height: listRect.height }
                        : null,
                    firstVisibleSourceOrdinal: visibleSources[0] ?? null,
                    mountedSelected: root?.querySelectorAll('.source-item.selected-for-batch').length || 0,
                    mountedFolded: root?.querySelectorAll('.source-item.sp-drag-folded').length || 0
                };
            }, ordinal).then((snapshot) => ({ attempt, ...metadata, ...snapshot })));
        }
        if (metadata.start <= ordinal && ordinal < metadata.end) {
            const row = page.locator(
                `#sources-list .source-item[data-source-window-ordinal="${ordinal}"]`
            );
            const rowMetrics = await page.evaluate((targetOrdinal) => {
                const root = document.querySelector('#sources-plus-root')?.shadowRoot;
                const list = root?.querySelector('#sources-list');
                const element = root?.querySelector(
                    `.source-item[data-source-window-ordinal="${targetOrdinal}"]`
                );
                if (!list || !element) return null;
                const rowRect = element.getBoundingClientRect();
                const listRect = list.getBoundingClientRect();
                return {
                    visible: Boolean(
                        rowRect.bottom > listRect.top
                        && rowRect.top < listRect.bottom
                    ),
                    centerY: rowRect.top + rowRect.height / 2,
                    folded: element.classList.contains('sp-drag-folded'),
                    height: rowRect.height
                };
            }, ordinal);
            if (!rowMetrics) {
                await page.evaluate(() => new Promise((resolve) => {
                    requestAnimationFrame(() => requestAnimationFrame(resolve));
                }));
                continue;
            }
            if (rowMetrics.visible && (allowFolded || (
                rowMetrics.folded === false && rowMetrics.height > 1
            ))) {
                return row;
            }
            if (rowMetrics.visible && allowFolded === false) {
                await expect.poll(() => row.evaluate((element) => {
                    const rect = element.getBoundingClientRect();
                    return element.classList.contains('sp-drag-folded') === false && rect.height > 1;
                })).toBe(true);
                continue;
            }

            const list = page.locator('#sources-list');
            const box = await list.boundingBox();
            expect(box).not.toBeNull();
            const beforeScrollTop = metadata.scrollTop;
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await page.mouse.wheel(
                0,
                rowMetrics.centerY - (box.y + box.height / 2)
            );
            await expect.poll(async () => {
                const next = await getSourceWindowMetadata(page);
                return Boolean(next && next.scrollTop !== beforeScrollTop);
            }).toBe(true);
            continue;
        }
        const list = page.locator('#sources-list');
        const box = await list.boundingBox();
        expect(box).not.toBeNull();
        const direction = ordinal >= metadata.end ? 1 : -1;
        const distance = Math.max(
            480,
            Math.abs(ordinal - (direction > 0 ? metadata.end : metadata.start)) * 32
        );
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        const beforeScrollTop = metadata.scrollTop;
        await page.mouse.wheel(0, direction * distance);
        await expect.poll(async () => {
            const next = await getSourceWindowMetadata(page);
            return Boolean(next && next.scrollTop !== beforeScrollTop);
        }).toBe(true);
    }
    const diagnosticTail = Array.isArray(diagnostics)
        ? JSON.stringify(diagnostics.slice(-12))
        : '';
    throw new Error(`Could not materialize source window ordinal ${ordinal}. ${diagnosticTail}`);
}

async function scrollWindowToTop(page) {
    for (let attempt = 0; attempt < 24; attempt += 1) {
        const metadata = await getSourceWindowMetadata(page);
        if (!metadata) throw new Error('Windowed sources list disappeared.');
        if (metadata.scrollTop <= 1) return;
        const list = page.locator('#sources-list');
        const box = await list.boundingBox();
        expect(box).not.toBeNull();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        const beforeScrollTop = metadata.scrollTop;
        await page.mouse.wheel(0, -Math.max(480, Math.min(beforeScrollTop, 3_200)));
        await expect.poll(async () => {
            const next = await getSourceWindowMetadata(page);
            return Boolean(next && next.scrollTop < beforeScrollTop);
        }).toBe(true);
    }
    throw new Error('Could not return the windowed sources list to its physical top.');
}

async function readWindowedRowState(page, sourceKey) {
    return page.evaluate((key) => {
        const root = document.querySelector('#sources-plus-root')?.shadowRoot;
        const list = root?.querySelector('#sources-list');
        const row = root?.querySelector(`.source-item[data-source-key="${CSS.escape(key)}"]`);
        if (!list || !row) return null;
        const rowRect = row.getBoundingClientRect();
        const listRect = list.getBoundingClientRect();
        return {
            selected: row.classList.contains('selected-for-batch'),
            folded: row.classList.contains('sp-drag-folded'),
            height: rowRect.height,
            visible: rowRect.bottom > listRect.top && rowRect.top < listRect.bottom,
            top: rowRect.top,
            bottom: rowRect.bottom,
            listTop: listRect.top,
            listBottom: listRect.bottom
        };
    }, sourceKey);
}

async function selectFiftyCrossWindowSources(page) {
    await page.locator('#sp-batch-action-btn').click();
    await page.locator('#sp-search-btn').click();
    const search = page.locator('#sp-search');
    await search.fill('CROSS50');
    await expect.poll(() => getSourceWindowMetadata(page)).toMatchObject({
        active: false,
        logicalSourceCount: 50
    });
    await page.locator('.sp-batch-select-visible-btn').click();
    await expect.poll(() => page.evaluate(() => {
        const root = document.querySelector('#sources-plus-root')?.shadowRoot;
        return Number(root?.querySelector('#sources-list')?.dataset.pendingSelected) || 0;
    })).toBe(50);
    const selectedKeys = await page.locator('#sources-list .source-item.selected-for-batch')
        .evaluateAll((rows) => rows.map((row) => row.dataset.sourceKey));
    expect(selectedKeys).toHaveLength(50);
    await search.fill('');
    await page.locator('#sp-search-close-btn').click();
    await expect(page.locator('.sp-controls.is-search-expanded')).toHaveCount(0);
    await expect.poll(() => getSourceWindowMetadata(page)).toMatchObject({
        active: true,
        logicalSourceCount: 260
    });
    await expect.poll(() => page.evaluate(() => {
        const root = document.querySelector('#sources-plus-root')?.shadowRoot;
        return Number(root?.querySelector('#sources-list')?.dataset.pendingSelected) || 0;
    })).toBe(50);
    return selectedKeys;
}

async function selectTwoWindowedSources(page, originOrdinal, remoteOrdinal) {
    await page.locator('#sp-batch-action-btn').click();
    const origin = await scrollWindowToOrdinal(page, originOrdinal);
    const originKey = await origin.getAttribute('data-source-key');
    await origin.locator('.sp-batch-checkbox').click();
    await expect.poll(() => page.evaluate(() => {
        const root = document.querySelector('#sources-plus-root')?.shadowRoot;
        return Number(root?.querySelector('#sources-list')?.dataset.pendingSelected) || 0;
    })).toBe(1);
    const remote = await scrollWindowToOrdinal(page, remoteOrdinal);
    const remoteKey = await remote.getAttribute('data-source-key');
    await remote.locator('.sp-batch-checkbox').click();
    await expect.poll(() => page.evaluate(() => {
        const root = document.querySelector('#sources-plus-root')?.shadowRoot;
        return Number(root?.querySelector('#sources-list')?.dataset.pendingSelected) || 0;
    })).toBe(2);
    return { originKey, remoteKey };
}

async function readMountedSelectionMetrics(page) {
    return page.evaluate(() => {
        const root = document.querySelector('#sources-plus-root')?.shadowRoot;
        const list = root?.querySelector('#sources-list');
        return {
            pendingSelected: Number(list?.dataset.pendingSelected) || 0,
            selectedRows: list?.querySelectorAll('.source-item.selected-for-batch').length || 0,
            foldedRows: list?.querySelectorAll('.source-item.sp-drag-folded').length || 0,
            windowStart: Number(list?.dataset.sourceWindowStart) || 0,
            windowEnd: Number(list?.dataset.sourceWindowEnd) || 0
        };
    });
}

async function expectUsableDragOrigin(row, expectedKey) {
    expect(await row.getAttribute('data-source-key')).toBe(expectedKey);
    await expect(row.locator('.sp-drag-handle')).toBeEnabled();
    await expect.poll(() => row.evaluate((element) => ({
        folded: element.classList.contains('sp-drag-folded'),
        height: element.getBoundingClientRect().height
    }))).toMatchObject({ folded: false });
    await expect.poll(() => row.evaluate((element) => element.getBoundingClientRect().height))
        .toBeGreaterThan(1);
}

async function expectVisibleWindowedDropTarget(target) {
    await expect(target).toHaveCount(1);
    await expect.poll(() => target.evaluate((element) => {
        const root = document.querySelector('#sources-plus-root')?.shadowRoot;
        const listRect = root?.querySelector('#sources-list')?.getBoundingClientRect();
        const rect = element.getBoundingClientRect();
        return rect.height > 1 && Boolean(
            listRect && rect.bottom > listRect.top && rect.top < listRect.bottom
        );
    })).toBe(true);
}

async function finishTrustedMouseDrop(page, target, position) {
    const box = await target.boundingBox();
    expect(box).not.toBeNull();
    const x = box.x + box.width * position.x;
    const y = box.y + box.height * position.y;
    const eventCountBeforeMove = await page.evaluate(() => window.__reflowTrustedEvents.length);
    await page.mouse.move(x, y, { steps: 14 });
    await page.mouse.move(x + 1, y, { steps: 2 });
    await expect.poll(() => page.evaluate((index) => (
        window.__reflowTrustedEvents.slice(index).some(
            (event) => event.type === 'pointermove' && event.trusted && event.defaultPrevented
        )
    ), eventCountBeforeMove)).toBe(true);
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => window.__reflowTrustedEvents.some(
        (event) => event.type === 'pointerup' && event.trusted
    ))).toBe(true);
    await expect(page.locator('.sp-drag-folded')).toHaveCount(0);
}

async function readRetryPointerDiagnostics(page) {
    return page.evaluate(() => {
        const root = document.querySelector('#sources-plus-root')?.shadowRoot;
        const list = root?.querySelector('#sources-list');
        const events = Array.isArray(window.__reflowTrustedEvents)
            ? window.__reflowTrustedEvents.slice(-40)
            : [];
        const latestPointer = [...events].reverse().find((event) => (
            event.type === 'pointerdown' || event.type === 'pointermove'
        ));
        const describeElement = (element) => {
            const target = element instanceof Element ? element : null;
            const sourceRow = target?.closest?.('.source-item') || null;
            const groupHeader = target?.closest?.('.group-header') || null;
            return {
                tagName: target?.tagName || '',
                className: typeof target?.className === 'string' ? target.className : '',
                sourceKey: sourceRow?.dataset?.sourceKey || '',
                groupId: groupHeader?.dataset?.groupId || '',
                sourceDraggable: sourceRow?.draggable ?? null
            };
        };
        const pointTarget = latestPointer
            ? (root?.elementFromPoint?.(latestPointer.clientX, latestPointer.clientY)
                || document.elementFromPoint(latestPointer.clientX, latestPointer.clientY))
            : null;
        const selection = window.getSelection?.();
        return {
            events,
            latestPointer,
            pointTarget: describeElement(pointTarget),
            activeElement: describeElement(root?.activeElement || document.activeElement),
            selection: {
                type: selection?.type || '',
                rangeCount: selection?.rangeCount || 0,
                textLength: selection?.toString?.().length || 0
            },
            list: {
                className: list?.className || '',
                windowStart: list?.dataset?.sourceWindowStart || '',
                windowEnd: list?.dataset?.sourceWindowEnd || '',
                pinnedCount: list?.dataset?.pinnedCount || '',
                dragActive: list?.classList.contains('sp-drag-active') || false
            }
        };
    });
}

async function readDragStartDiagnostics(page, sourceKey) {
    return page.evaluate((key) => {
        const root = document.querySelector('#sources-plus-root')?.shadowRoot;
        const list = root?.querySelector('#sources-list');
        const row = root?.querySelector(`.source-item[data-source-key="${CSS.escape(key)}"]`);
        const rowRect = row?.getBoundingClientRect();
        const lastPointer = [...(window.__reflowTrustedEvents || [])].reverse().find((event) => (
            event.type === 'pointermove' || event.type === 'pointerdown'
        ));
        const pointTarget = lastPointer
            ? root?.elementFromPoint(lastPointer.clientX, lastPointer.clientY)
            : null;
        const describe = (element) => ({
            tagName: element?.tagName || '',
            className: typeof element?.className === 'string' ? element.className : '',
            sourceKey: element?.closest?.('.source-item')?.dataset?.sourceKey || '',
            draggable: element?.closest?.('.source-item')?.draggable ?? null
        });
        return {
            row: row ? {
                sourceKey: row.dataset.sourceKey || '',
                ordinal: row.dataset.sourceWindowOrdinal || '',
                draggable: row.draggable,
                selected: row.classList.contains('selected-for-batch'),
                folded: row.classList.contains('sp-drag-folded'),
                rect: {
                    width: rowRect?.width || 0,
                    height: rowRect?.height || 0,
                    top: rowRect?.top || 0,
                    bottom: rowRect?.bottom || 0
                }
            } : null,
            list: {
                scrollTop: list?.scrollTop || 0,
                start: list?.dataset.sourceWindowStart || '',
                end: list?.dataset.sourceWindowEnd || ''
            },
            lastPointer,
            pointTarget: describe(pointTarget),
            events: window.__reflowTrustedEvents || []
        };
    }, sourceKey);
}

function buildExpandedMixedTree(snapshot, {
    rootGroupCount = 12,
    sourcesPerGroup = 8
} = {}) {
    const sourceKeys = Array.isArray(snapshot?.ungrouped) ? snapshot.ungrouped.slice() : [];
    if (sourceKeys.length !== 260) {
        throw new Error(`Expected 260 persisted sources, received ${sourceKeys.length}.`);
    }
    const groupsById = {};
    const root = [];
    const assigned = new Set();
    let cursor = 0;
    for (let index = 0; index < rootGroupCount; index += 1) {
        const groupId = `mixed-root-${index}`;
        const groupKeys = sourceKeys.slice(cursor, cursor + sourcesPerGroup);
        cursor += groupKeys.length;
        groupKeys.forEach((key) => assigned.add(key));
        let children = groupKeys.map((key) => ({ type: 'source', key }));
        if (index === 3) {
            const nestedGroupId = 'mixed-nested';
            const nestedKeys = groupKeys.slice(3, 5);
            groupsById[nestedGroupId] = {
                id: nestedGroupId,
                title: 'Nested mixed boundary',
                enabled: true,
                collapsed: false,
                children: nestedKeys.map((key) => ({ type: 'source', key }))
            };
            children = [
                ...groupKeys.slice(0, 3).map((key) => ({ type: 'source', key })),
                { type: 'group', id: nestedGroupId },
                ...groupKeys.slice(5).map((key) => ({ type: 'source', key }))
            ];
        }
        groupsById[groupId] = {
            id: groupId,
            title: `Expanded mixed group ${index}`,
            enabled: true,
            collapsed: false,
            children
        };
        root.push({ type: 'group', id: groupId });
    }
    return {
        ...snapshot,
        root,
        ungrouped: sourceKeys.filter((key) => !assigned.has(key)),
        groupsById
    };
}

async function readViewportSources(page) {
    return page.evaluate(() => {
        const root = document.querySelector('#sources-plus-root')?.shadowRoot;
        const list = root?.querySelector('#sources-list');
        if (!root || !list) return null;
        const listRect = list.getBoundingClientRect();
        const visibleSourceOrdinals = Array.from(root.querySelectorAll('.source-item')).flatMap((row) => {
            const rect = row.getBoundingClientRect();
            return rect.height > 1 && rect.bottom > listRect.top && rect.top < listRect.bottom
                ? [Number(row.dataset.sourceWindowOrdinal)]
                : [];
        });
        const visibleSpacers = Array.from(root.querySelectorAll('.sp-source-window-spacer')).filter((spacer) => {
            const rect = spacer.getBoundingClientRect();
            return rect.height > 1 && rect.bottom > listRect.top && rect.top < listRect.bottom;
        }).map((spacer) => ({
            start: Number(spacer.dataset.sourceWindowStart),
            end: Number(spacer.dataset.sourceWindowEnd)
        }));
        return { visibleSourceOrdinals, visibleSpacers };
    });
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
        await finishTrustedDrop(page, origin, target, { x: 0.8, y: 0.5 }, { followTarget: true });
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
        await expect(page.locator('#sources-list.sp-drag-active')).toHaveCount(0);
        await expect(page.locator('.sp-drag-folded, .sp-drop-shift, .sp-drop-shift-static')).toHaveCount(0);
        expect(await readTree(bridge)).toEqual(before);
        await page.reload();
        await expect(page.locator('#sources-list .source-item')).toHaveCount(6);
        await expect.poll(() => readTree(bridge)).toEqual(before);
    });
});

test.describe.serial('windowed reflow trusted drag', () => {
    let env;
    let bridge;
    let page;

    test.setTimeout(120_000);

    test.beforeEach(async () => {
        env = await launchExtensionContext(repoRoot);
        await installNotebookFixture(env.context, {
            resolveSources: () => Array.from({ length: 260 }, (_, index) => ({
                id: `windowed-source-${String(index + 1).padStart(3, '0')}`,
                token: `windowed-source-${String(index + 1).padStart(3, '0')}`,
                title: `Windowed source ${String(index + 1).padStart(3, '0')}${
                    fiftySelectionOrdinals.includes(index) ? ' CROSS50' : ''
                }`
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
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.goto(`https://notebook.google.com/notebook/${windowedNotebookId}`);
        await configureWindowedList(page);
    });

    test.afterEach(async () => {
        if (env) await closeExtensionContext(env);
        env = null;
    });

    test('keeps a cross-window batch folded through trusted wheel scrolling and cancel/retry cleanup', async ({}, testInfo) => {
        const targetGroupId = await createFolder(page, 'Window destination');
        const originOrdinal = 2;
        const remoteOrdinal = 178;
        const { originKey, remoteKey } = await selectTwoWindowedSources(
            page,
            originOrdinal,
            remoteOrdinal
        );
        const before = await readTree(bridge, windowedNotebookId);
        const target = page.locator(
            `.group-container[data-group-id="${targetGroupId}"] .group-header`
        ).first();

        const rematerializedOrigin = await scrollWindowToOrdinal(page, originOrdinal);
        await expectUsableDragOrigin(rematerializedOrigin, originKey);
        await startTrustedDrag(page, rematerializedOrigin);
        await expect.poll(async () => (await getSourceWindowMetadata(page))?.start).toBeLessThanOrEqual(originOrdinal);

        await scrollWindowToOrdinal(page, remoteOrdinal + 1);
        await expect.poll(() => readWindowedRowState(page, remoteKey)).toMatchObject({
            selected: true,
            folded: true,
            visible: true
        });
        await expect.poll(async () => (await readWindowedRowState(page, remoteKey))?.height).toBeLessThanOrEqual(1);
        await expect.poll(() => page.evaluate(() => window.__reflowTrustedEvents.some(
            (event) => event.type === 'scroll' && event.trusted
        ))).toBe(true);
        const beforeCancel = {
            window: await getSourceWindowMetadata(page),
            row: await readWindowedRowState(page, remoteKey)
        };

        await page.keyboard.press('Escape');
        await page.mouse.up();
        await expect(page.locator('#sources-list.sp-drag-active')).toHaveCount(0);
        await expect(page.locator('.sp-drag-folded, .sp-drop-shift, .sp-drop-shift-static')).toHaveCount(0);
        const afterCancel = {
            window: await getSourceWindowMetadata(page),
            row: await readWindowedRowState(page, remoteKey)
        };
        expect(Math.abs(afterCancel.window.scrollTop - beforeCancel.window.scrollTop))
            .toBeLessThanOrEqual(96);
        await scrollWindowToOrdinal(page, remoteOrdinal);
        await expect.poll(() => readWindowedRowState(page, remoteKey)).toMatchObject({
            selected: true,
            folded: false,
            visible: true
        });
        await expect.poll(async () => (await readWindowedRowState(page, remoteKey))?.height).toBeGreaterThan(1);
        await expect.poll(() => readTree(bridge, windowedNotebookId)).toEqual(before);

        await expect(page.locator('.sp-drag-unfolding')).toHaveCount(0);
        await page.mouse.move(10, 10);
        await expect(page.locator('#sources-list.sp-drag-active')).toHaveCount(0);
        // The selected source can remain pinned at a remote list position after
        // cancellation, while the root header is at the physical top. Start the
        // retry from the usable source, then return the active native drag to the
        // target with a real wheel gesture.
        const retryOrigin = await scrollWindowToOrdinal(page, originOrdinal);
        await expectUsableDragOrigin(retryOrigin, originKey);
        await startTrustedDrag(page, retryOrigin);
        await scrollWindowToTop(page);
        await expectVisibleWindowedDropTarget(target);
        try {
            await finishTrustedMouseDrop(page, target, { x: 0.75, y: 0.5 });
        } catch (error) {
            await testInfo.attach('cancel-retry-pointer-diagnostics.json', {
                body: JSON.stringify(await readRetryPointerDiagnostics(page), null, 2),
                contentType: 'application/json'
            });
            throw error;
        }
        const expectedChildren = [originKey, remoteKey].map((key) => ({ type: 'source', key }));
        await expect.poll(async () => (
            (await readTree(bridge, windowedNotebookId))?.groupsById?.[targetGroupId]?.children
        )).toEqual(expectedChildren);
    });

    test('keeps a fifty-source cross-window batch physically folded and commits tree-order placement', async ({}, testInfo) => {
        const targetGroupId = await createFolder(page, 'Fifty source destination');
        const selectedKeys = await selectFiftyCrossWindowSources(page);
        const originOrdinal = fiftySelectionOrdinals[0];
        const remoteOrdinal = fiftySelectionOrdinals[40];
        const remoteAnchorOrdinal = remoteOrdinal + 1;
        const origin = await scrollWindowToOrdinal(page, originOrdinal);
        expect(await origin.getAttribute('data-source-key')).toBe(selectedKeys[0]);
        const target = page.locator(
            `.group-container[data-group-id="${targetGroupId}"] .group-header`
        ).first();

        try {
            await startTrustedDrag(page, origin);
        } catch (error) {
            await testInfo.attach('fifty-source-drag-start.json', {
                body: JSON.stringify(await readDragStartDiagnostics(page, selectedKeys[0]), null, 2),
                contentType: 'application/json'
            });
            throw error;
        }
        await expect.poll(async () => {
            const metrics = await readMountedSelectionMetrics(page);
            return metrics.selectedRows > 0 && metrics.selectedRows < 50
                && metrics.foldedRows === metrics.selectedRows;
        }).toBe(true);
        const initialSelection = await readMountedSelectionMetrics(page);
        expect(initialSelection).toMatchObject({ pendingSelected: 50 });
        expect(initialSelection.selectedRows).toBeGreaterThan(0);
        expect(initialSelection.selectedRows).toBeLessThan(50);
        expect(initialSelection.foldedRows).toBe(initialSelection.selectedRows);

        const remoteScrollDiagnostics = [];
        let remoteAnchor;
        try {
            remoteAnchor = await scrollWindowToOrdinal(page, remoteAnchorOrdinal, {
                diagnostics: remoteScrollDiagnostics
            });
        } catch (error) {
            await testInfo.attach('fifty-source-window-scroll.json', {
                body: JSON.stringify(remoteScrollDiagnostics, null, 2),
                contentType: 'application/json'
            });
            throw error;
        }
        expect(await remoteAnchor.getAttribute('data-source-key')).not.toBe(selectedKeys[40]);
        const remoteKey = selectedKeys[40];
        await expect.poll(() => readWindowedRowState(page, remoteKey)).toMatchObject({
            selected: true,
            folded: true,
            visible: true
        });
        await expect.poll(async () => (await readWindowedRowState(page, remoteKey))?.height)
            .toBeLessThanOrEqual(1);
        await expect.poll(async () => {
            const metrics = await readMountedSelectionMetrics(page);
            return metrics.selectedRows > 0 && metrics.selectedRows < 50
                && metrics.foldedRows === metrics.selectedRows;
        }).toBe(true);
        const remoteSelection = await readMountedSelectionMetrics(page);
        expect(remoteSelection).toMatchObject({ pendingSelected: 50 });
        expect(remoteSelection.selectedRows).toBeGreaterThan(0);
        expect(remoteSelection.selectedRows).toBeLessThan(50);
        expect(remoteSelection.foldedRows).toBe(remoteSelection.selectedRows);

        // Keep the same trusted drag active while returning from the remote
        // window. This covers a real cross-window commit, rather than only
        // verifying a later fresh drag session.
        await scrollWindowToTop(page);
        await expectVisibleWindowedDropTarget(target);
        await finishTrustedMouseDrop(page, target, { x: 0.75, y: 0.5 });
        const expectedChildren = selectedKeys.map((key) => ({ type: 'source', key }));
        await expect.poll(async () => (
            (await readTree(bridge, windowedNotebookId))?.groupsById?.[targetGroupId]?.children
        )).toEqual(expectedChildren);
        const stored = await readTree(bridge, windowedNotebookId);
        const allSourceKeys = [
            ...stored.ungrouped,
            ...Object.values(stored.groupsById).flatMap((group) => (
                group.children
                    .filter((entry) => entry.type === 'source')
                    .map((entry) => entry.key)
            ))
        ];
        expect(allSourceKeys).toHaveLength(260);
        expect(new Set(allSourceKeys).size).toBe(260);
        await page.reload();
        await expect.poll(() => readTree(bridge, windowedNotebookId)).toEqual(stored);
    });
});

test.describe.serial('mixed-height grouped source window', () => {
    let env;
    let bridge;
    let page;
    let expectedSourceKeys;

    test.setTimeout(90_000);

    test.beforeEach(async () => {
        env = await launchExtensionContext(repoRoot);
        await installNotebookFixture(env.context, {
            resolveSources: () => Array.from({ length: 260 }, (_, index) => ({
                id: `mixed-source-${String(index + 1).padStart(3, '0')}`,
                token: `mixed-source-${String(index + 1).padStart(3, '0')}`,
                title: index % 3 === 0
                    ? `Mixed source ${index + 1} ${'very-long-wrapping-title '.repeat(18)}`
                    : `Mixed source ${index + 1}`
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
        await page.setViewportSize({ width: 520, height: 900 });
        await page.goto(`https://notebook.google.com/notebook/${mixedWindowedNotebookId}`);
        await expect.poll(() => getSourceWindowMetadata(page)).toMatchObject({
            active: true,
            logicalSourceCount: 260
        });
        await page.addStyleTag({ content: '[data-testid="source-panel"] { width: 240px; }' });

        // A real UI save establishes the normal storage envelope; only the
        // isolated fixture's arrangement is then seeded before a full reload.
        await createFolder(page, 'Mixed tree seed');
        await expect.poll(async () => (
            (await readStoredSnapshot(bridge, mixedWindowedNotebookId))?.value?.ungrouped?.length
        )).toBe(260);
        const stored = await readStoredSnapshot(bridge, mixedWindowedNotebookId);
        expectedSourceKeys = stored.value.ungrouped.slice();
        const mixedTree = buildExpandedMixedTree(stored.value, {
            rootGroupCount: 32,
            sourcesPerGroup: 7
        });
        await page.close();
        await writeIsolatedSnapshot(bridge, {
            key: stored.key,
            value: mixedTree
        });
        page = await env.context.newPage();
        await page.setViewportSize({ width: 520, height: 900 });
        await page.goto(`https://notebook.google.com/notebook/${mixedWindowedNotebookId}`);
        await page.addStyleTag({ content: '[data-testid="source-panel"] { width: 240px; }' });
        await configureWindowedList(page);
        await expect(page.locator('.group-container')).toHaveCount(33);
    });

    test.afterEach(async () => {
        if (env) await closeExtensionContext(env);
        env = null;
    });

    test('keeps real logical sources materialized at first, nested, middle, and final window boundaries', async ({}, testInfo) => {
        const observations = [];
        for (const ordinal of [2, 24, 130, 246, 259]) {
            const row = await scrollWindowToOrdinal(page, ordinal);
            const key = await row.getAttribute('data-source-key');
            expect(key).toBe(expectedSourceKeys[ordinal]);
            const state = await readWindowedRowState(page, key);
            expect(state).toMatchObject({ folded: false, visible: true });
            expect(state.height).toBeGreaterThan(1);
            const metadata = await getSourceWindowMetadata(page);
            expect(metadata.start).toBeLessThanOrEqual(ordinal);
            expect(metadata.end).toBeGreaterThan(ordinal);
            const viewport = await readViewportSources(page);
            expect(viewport.visibleSourceOrdinals.length).toBeGreaterThan(0);
            expect(viewport.visibleSourceOrdinals).toContain(ordinal);
            if (ordinal === 24) {
                await expect(row.evaluate((element) => (
                    element.closest('.group-container')?.dataset.groupId
                ))).resolves.toBe('mixed-nested');
            }
            observations.push({ ordinal, metadata, state, viewport });
        }
        await testInfo.attach('mixed-height-window-observation.json', {
            body: JSON.stringify(observations, null, 2),
            contentType: 'application/json'
        });
    });
});
