const fs = require('fs');
const os = require('os');
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

function createBridgeScript() {
    function installDragReflowLayoutBridge() {
        const originalFactory = globalThis.NSM_CREATE_CONTENT_DRAG_REFLOW;
        if (typeof originalFactory !== 'function') {
            throw new Error('Drag reflow factory is unavailable to the layout smoke bridge.');
        }

        let active = null;
        const serializeRect = (rect) => ({
            top: rect?.top || 0,
            bottom: rect?.bottom || 0,
            height: rect?.height || 0
        });
        const serializeInline = (element) => ({
            height: element?.style.getPropertyValue('height') || '',
            heightPriority: element?.style.getPropertyPriority('height') || '',
            opacity: element?.style.getPropertyValue('opacity') || '',
            opacityPriority: element?.style.getPropertyPriority('opacity') || '',
            transition: element?.style.getPropertyValue('transition') || '',
            transitionPriority: element?.style.getPropertyPriority('transition') || '',
            animation: element?.style.getPropertyValue('animation') || '',
            animationPriority: element?.style.getPropertyPriority('animation') || '',
            overflowAnchor: element?.style.getPropertyValue('overflow-anchor') || '',
            overflowAnchorPriority: element?.style.getPropertyPriority('overflow-anchor') || ''
        });
        const getIdentity = (element) => (
            element?.getAttribute('data-source-key')
            || element?.getAttribute('data-group-id')
            || ''
        );
        const findByKey = (fixtureRoot, key) => (
            fixtureRoot?.querySelector(`[data-source-key="${CSS.escape(key)}"]`)
            || fixtureRoot?.querySelector(`[data-group-id="${CSS.escape(key)}"]`)
            || null
        );
        const serializeRects = (fixtureRoot) => Object.fromEntries(
            Array.from(fixtureRoot?.querySelectorAll(
                '[data-source-key], [data-group-id]'
            ) || []).map((element) => [
                getIdentity(element),
                serializeRect(element.getBoundingClientRect())
            ])
        );
        const serializeSession = (session) => ({
            totalDraggedHeight: session?.totalDraggedHeight || 0,
            draggedRuns: Array.isArray(session?.draggedRuns)
                ? session.draggedRuns.map((run) => ({
                    keys: Array.isArray(run.keys) ? run.keys.slice() : [],
                    cumulativeDisplacement: run.cumulativeDisplacement,
                    footprint: run.footprint
                }))
                : [],
            itemMetrics: session?.itemMetrics instanceof Map
                ? Array.from(session.itemMetrics, ([key, metrics]) => [key, metrics])
                : [],
            probeMetrics: session?.probeMetrics || null
        });
        const getHost = () => document.querySelector('#sources-plus-root');
        const respond = (host, result) => {
            host.setAttribute('data-drag-reflow-layout-result', JSON.stringify(result));
        };

        document.addEventListener('sources-plus-drag-reflow-layout-command', () => {
            const host = getHost();
            const shadowRoot = host?.shadowRoot || null;
            if (!host || !shadowRoot) return;
            const command = host.getAttribute('data-drag-reflow-layout-command');
            const args = JSON.parse(host.getAttribute('data-drag-reflow-layout-args') || '{}');
            const fixtureRoot = shadowRoot.querySelector('#sp-drag-layout-fixture');
            const dragged = fixtureRoot?.querySelector('[data-source-key="drag"]') || null;
            const next = fixtureRoot?.querySelector('[data-source-key="next"]') || null;

            if (command === 'prepare') {
                const api = originalFactory();
                const draggedKeys = Array.isArray(args.draggedKeys) && args.draggedKeys.length
                    ? args.draggedKeys
                    : ['drag'];
                const beforeRect = serializeRect(dragged?.getBoundingClientRect());
                const beforeNextRect = serializeRect(next?.getBoundingClientRect());
                const beforeInline = serializeInline(dragged);
                const beforeRootRect = serializeRect(fixtureRoot?.getBoundingClientRect());
                const beforeRootScrollTop = fixtureRoot?.scrollTop || 0;
                const beforeRects = serializeRects(fixtureRoot);
                const session = api.prepareDragSession({
                    draggedKeys,
                    rootElement: fixtureRoot
                });
                active = { api, session, rootElement: fixtureRoot, draggedKeys };
                const afterRect = serializeRect(dragged?.getBoundingClientRect());
                const metric = session?.itemMetrics instanceof Map
                    ? session.itemMetrics.get('drag')
                    : null;
                respond(host, {
                    beforeRect,
                    beforeNextRect,
                    beforeInline,
                    beforeRootRect,
                    beforeRootScrollTop,
                    beforeRects,
                    afterRect,
                    afterRootRect: serializeRect(fixtureRoot?.getBoundingClientRect()),
                    afterRootScrollTop: fixtureRoot?.scrollTop || 0,
                    afterRects: serializeRects(fixtureRoot),
                    session: serializeSession(session),
                    metric,
                    sentinelCount: fixtureRoot?.querySelectorAll(
                        '[data-sp-drag-measurement], [data-sp-drag-probe]'
                    ).length || 0,
                    selectedAnimationCount: draggedKeys.reduce((count, key) => (
                        count + (findByKey(fixtureRoot, key)?.getAnimations().length || 0)
                    ), 0),
                    inline: serializeInline(dragged)
                });
                return;
            }

            if (command === 'preview' && active) {
                const siblingKeys = Array.isArray(args.siblingKeys) ? args.siblingKeys : [];
                const shifts = active.api.computeReflow({
                    session: active.session,
                    insertIndex: Number(args.insertIndex),
                    siblingKeys
                });
                active.api.applyReflow({
                    session: active.session,
                    shifts,
                    rootElement: active.rootElement
                });
                respond(host, {
                    shifts: Array.from(shifts),
                    rects: serializeRects(active.rootElement)
                });
                return;
            }

            if (command === 'clear-preview' && active) {
                active.api.clearReflow({
                    session: active.session,
                    rootElement: active.rootElement
                });
                respond(host, {
                    rects: serializeRects(active.rootElement)
                });
                return;
            }

            if (command === 'fold' && active) {
                active.api.foldDraggedItems(active);
                respond(host, { ok: true });
                return;
            }

            if (command === 'unfold' && active) {
                active.api.unfoldDraggedItems(Object.assign({}, active, {
                    animated: args.animated !== false
                }));
                respond(host, { ok: true });
                return;
            }

            if (command === 'snapshot') {
                respond(host, {
                    rect: serializeRect(dragged?.getBoundingClientRect()),
                    nextRect: serializeRect(next?.getBoundingClientRect()),
                    rootRect: serializeRect(fixtureRoot?.getBoundingClientRect()),
                    rects: serializeRects(fixtureRoot),
                    sentinelCount: fixtureRoot?.querySelectorAll(
                        '[data-sp-drag-measurement], [data-sp-drag-probe]'
                    ).length || 0,
                    selectedAnimationCount: (active?.draggedKeys || []).reduce((count, key) => (
                        count + (findByKey(fixtureRoot, key)?.getAnimations().length || 0)
                    ), 0),
                    inline: {
                        height: dragged?.style.getPropertyValue('height') || '',
                        heightPriority: dragged?.style.getPropertyPriority('height') || '',
                        opacity: dragged?.style.getPropertyValue('opacity') || '',
                        opacityPriority: dragged?.style.getPropertyPriority('opacity') || ''
                    }
                });
            }
        });
    }

    return `(${installDragReflowLayoutBridge.toString()})();\n`;
}

function createInstrumentedExtensionRoot() {
    const extensionRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gemininotebook-drag-reflow-layout-'));
    fs.cpSync(path.join(repoRoot, 'manifest.json'), path.join(extensionRoot, 'manifest.json'));
    fs.cpSync(path.join(repoRoot, 'src'), path.join(extensionRoot, 'src'), { recursive: true });
    fs.cpSync(path.join(repoRoot, '_locales'), path.join(extensionRoot, '_locales'), { recursive: true });

    const bridgeFilename = 'drag-reflow-layout-bridge.js';
    fs.writeFileSync(path.join(extensionRoot, bridgeFilename), createBridgeScript(), 'utf8');
    const instrumentedManifestPath = path.join(extensionRoot, 'manifest.json');
    const instrumentedManifest = JSON.parse(fs.readFileSync(instrumentedManifestPath, 'utf8'));
    const scripts = instrumentedManifest.content_scripts[0].js;
    const reflowIndex = scripts.indexOf('src/content/content-drag-reflow.js');
    scripts.splice(reflowIndex + 1, 0, bridgeFilename);
    fs.writeFileSync(instrumentedManifestPath, `${JSON.stringify(instrumentedManifest, null, 2)}\n`, 'utf8');
    return extensionRoot;
}

async function seedReflowPreference(context, extensionId) {
    const bridgePage = await openExtensionPage(context, extensionId, 'src/popup/popup.html');
    try {
        const response = await bridgePage.evaluate(async ({ version }) => chrome.runtime.sendMessage({
            type: 'SAVE_PREFERENCES',
            preferences: {
                dragMode: 'reflow',
                welcomeOnboardingSeenVersion: 1,
                whatsNewSeenVersion: version
            }
        }), { version: manifest.version });
        if (!response?.success) throw new Error(response?.errorCode || 'preference_seed_failed');
    } finally {
        await bridgePage.close();
    }
}

async function bridge(page, command, args = {}) {
    return page.evaluate(({ nextCommand, nextArgs }) => {
        const host = document.querySelector('#sources-plus-root');
        host.setAttribute('data-drag-reflow-layout-command', nextCommand);
        host.setAttribute('data-drag-reflow-layout-args', JSON.stringify(nextArgs));
        host.dispatchEvent(new Event('sources-plus-drag-reflow-layout-command', {
            bubbles: true,
            composed: true
        }));
        return JSON.parse(host.getAttribute('data-drag-reflow-layout-result') || 'null');
    }, { nextCommand: command, nextArgs: args });
}

async function installSyntheticLayoutFixture(page, nodes) {
    await page.evaluate((fixtureNodes) => {
        const shadowRoot = document.querySelector('#sources-plus-root').shadowRoot;
        shadowRoot.querySelector('#sp-drag-layout-fixture')?.remove();
        shadowRoot.querySelector('#sp-drag-layout-fixture-style')?.remove();

        const style = document.createElement('style');
        style.id = 'sp-drag-layout-fixture-style';
        style.textContent = `
            #sp-drag-layout-fixture {
                position: fixed;
                inset: 16px auto auto 16px;
                width: 360px;
                display: flow-root;
                overflow-anchor: auto;
            }
            #sp-drag-layout-fixture .layout-source {
                display: block;
                width: 100%;
                padding: 4px 8px;
                border: 1px solid transparent;
                margin: 4px 0;
                transition:
                    height 180ms linear,
                    opacity 180ms linear,
                    padding 180ms linear,
                    margin 180ms linear,
                    border-width 180ms linear;
            }
            #sp-drag-layout-fixture .layout-group {
                display: flow-root;
                box-sizing: border-box;
                padding: 3px;
                border: 1px solid transparent;
                margin: 8px 0 12px;
                transition:
                    height 180ms linear,
                    opacity 180ms linear,
                    padding 180ms linear,
                    margin 180ms linear,
                    border-width 180ms linear;
            }
            #sp-drag-layout-fixture .layout-group-header {
                box-sizing: border-box;
                height: 32px;
            }
            #sp-drag-layout-fixture .layout-group-children {
                display: flow-root;
                overflow-anchor: auto;
            }
            @media (prefers-reduced-motion: reduce) {
                #sp-drag-layout-fixture [data-source-key],
                #sp-drag-layout-fixture [data-group-id] {
                    transition: none !important;
                }
            }
        `;

        const createSource = (spec) => {
            const row = document.createElement('div');
            row.className = 'layout-source';
            row.setAttribute('data-source-key', spec.key);
            row.textContent = `Synthetic layout source ${spec.key}`;
            const boxSizing = spec.boxSizing || 'border-box';
            row.style.boxSizing = boxSizing;
            row.style.height = boxSizing === 'content-box' ? '38px' : '48px';
            row.style.opacity = '0.65';
            if (spec.marginTop !== undefined) row.style.marginTop = `${spec.marginTop}px`;
            if (spec.marginBottom !== undefined) row.style.marginBottom = `${spec.marginBottom}px`;
            return row;
        };

        const createNode = (spec) => {
            if (spec.type !== 'group') return createSource(spec);
            const group = document.createElement('section');
            group.className = 'layout-group';
            group.setAttribute('data-group-id', spec.key);
            const header = document.createElement('div');
            header.className = 'layout-group-header';
            header.textContent = `Synthetic layout group ${spec.key}`;
            const children = document.createElement('div');
            children.className = 'layout-group-children';
            children.setAttribute('data-layout-host', spec.key);
            if (spec.childrenHeight !== undefined) {
                children.style.height = `${spec.childrenHeight}px`;
            }
            if (spec.childrenOverflow) {
                children.style.overflow = spec.childrenOverflow;
            }
            for (const child of spec.children || []) {
                children.appendChild(createNode(child));
            }
            group.append(header, children);
            return group;
        };

        const root = document.createElement('div');
        root.id = 'sp-drag-layout-fixture';
        for (const spec of fixtureNodes) root.appendChild(createNode(spec));
        shadowRoot.append(style, root);
    }, nodes);
}

function expectRectMapsClose(actual, expected, tolerance = 1) {
    expect(Object.keys(actual || {}).sort()).toEqual(Object.keys(expected || {}).sort());
    for (const [key, expectedRect] of Object.entries(expected || {})) {
        const actualRect = actual[key];
        expect.soft(Math.abs(actualRect.top - expectedRect.top), `${key} top`).toBeLessThanOrEqual(tolerance);
        expect.soft(Math.abs(actualRect.height - expectedRect.height), `${key} height`).toBeLessThanOrEqual(tolerance);
    }
}

test('measures the real 48px folded footprint and restores the probe synchronously', async () => {
    const extensionRoot = createInstrumentedExtensionRoot();
    let env;
    try {
        env = await launchExtensionContext(extensionRoot);
        await installNotebookFixture(env.context);
        const extensionId = await waitForExtensionId(env.context, env.userDataDir, extensionRoot);
        await seedReflowPreference(env.context, extensionId);

        const page = await env.context.newPage();
        await page.goto('https://notebooklm.google.com/notebook/drag-reflow-layout');
        await expect(page.locator('#sources-plus-root')).toBeVisible({ timeout: 20_000 });
        await page.evaluate(() => {
            const shadowRoot = document.querySelector('#sources-plus-root').shadowRoot;
            const style = document.createElement('style');
            style.textContent = `
                #sp-drag-layout-fixture {
                    position: fixed;
                    inset: 16px auto auto 16px;
                    width: 320px;
                    display: flow-root;
                    overflow-anchor: auto;
                }
                #sp-drag-layout-fixture > [data-source-key] {
                    display: block;
                    box-sizing: border-box;
                    height: 48px;
                    padding: 3px 8px;
                    border: 1px solid transparent;
                    margin: 0;
                    transition:
                        height 180ms linear,
                        opacity 180ms linear,
                        padding 180ms linear,
                        margin 180ms linear,
                        border-width 180ms linear;
                }
                #sp-drag-layout-fixture > [data-source-key="prev"] { margin-bottom: 8px; }
                #sp-drag-layout-fixture > [data-source-key="drag"] { margin: 4px 0; }
                #sp-drag-layout-fixture > [data-source-key="next"] { margin-top: 16px; }
            `;
            const root = document.createElement('div');
            root.id = 'sp-drag-layout-fixture';
            for (const key of ['prev', 'drag', 'next', 'tail']) {
                const row = document.createElement('div');
                row.setAttribute('data-source-key', key);
                row.textContent = `Drag layout ${key}`;
                root.appendChild(row);
            }
            const dragged = root.querySelector('[data-source-key="drag"]');
            dragged.style.setProperty('height', '48px', 'important');
            dragged.style.setProperty('opacity', '0.65', 'important');
            dragged.style.setProperty('transition', 'height 180ms linear', 'important');
            dragged.style.setProperty('animation', 'none');
            dragged.style.setProperty('overflow-anchor', 'auto', 'important');
            shadowRoot.append(style, root);
        });

        const prepared = await bridge(page, 'prepare');
        expect.soft(prepared.session.totalDraggedHeight).toBeCloseTo(48, 0);
        expect.soft(prepared.session.draggedRuns).toEqual([
            expect.objectContaining({
                keys: ['drag'],
                cumulativeDisplacement: expect.closeTo(48, 0),
                footprint: expect.closeTo(48, 0)
            })
        ]);
        expect.soft(prepared.metric).toEqual(expect.objectContaining({
            borderBoxHeight: 48,
            unfoldHeight: 48
        }));
        expect.soft(Math.abs(prepared.afterRect.top - prepared.beforeRect.top)).toBeLessThanOrEqual(1);
        expect.soft(Math.abs(prepared.afterRect.height - prepared.beforeRect.height)).toBeLessThanOrEqual(1);
        expect.soft(prepared.sentinelCount).toBe(0);
        expect.soft(prepared.selectedAnimationCount).toBe(0);
        expect.soft(prepared.inline).toEqual(prepared.beforeInline);

        await bridge(page, 'fold');
        await page.waitForTimeout(240);
        const folded = await bridge(page, 'snapshot');
        expect.soft(folded.rect.height).toBeLessThanOrEqual(1);
        expect.soft(prepared.beforeNextRect.top - folded.nextRect.top).toBeCloseTo(
            prepared.session.totalDraggedHeight,
            0
        );
        expect.soft(folded.sentinelCount).toBe(0);

        await bridge(page, 'unfold', { animated: true });
        await page.waitForTimeout(240);
        const restored = await bridge(page, 'snapshot');
        expect.soft(Math.abs(restored.rect.height - prepared.beforeRect.height)).toBeLessThanOrEqual(1);
        expect.soft(restored.inline).toEqual({
            height: '48px',
            heightPriority: 'important',
            opacity: '0.65',
            opacityPriority: 'important'
        });
        expect.soft(restored.sentinelCount).toBe(0);
    } finally {
        await closeExtensionContext(env);
        fs.rmSync(extensionRoot, { recursive: true, force: true });
    }
});

test('covers first, last, mixed, terminal-nested, multi-run, and nested 50-item layout footprints', async () => {
    const extensionRoot = createInstrumentedExtensionRoot();
    let env;
    try {
        env = await launchExtensionContext(extensionRoot);
        await installNotebookFixture(env.context);
        const extensionId = await waitForExtensionId(env.context, env.userDataDir, extensionRoot);
        await seedReflowPreference(env.context, extensionId);

        const page = await env.context.newPage();
        await page.goto('https://notebooklm.google.com/notebook/drag-reflow-layout-matrix');
        await expect(page.locator('#sources-plus-root')).toBeVisible({ timeout: 20_000 });

        const flatNodes = [
            {
                key: 'flat-first',
                type: 'source',
                boxSizing: 'content-box',
                marginBottom: 8
            },
            {
                key: 'flat-middle',
                type: 'source',
                boxSizing: 'border-box',
                marginTop: 16
            },
            { key: 'flat-last', type: 'source' }
        ];
        const nestedGroupOne = Array.from({ length: 20 }, (_, index) => ({
            key: `nested-g1-${index}`,
            type: 'source'
        }));
        const nestedGroupTwo = Array.from({ length: 20 }, (_, index) => ({
            key: `nested-g2-${index}`,
            type: 'source'
        }));
        const nestedPre = Array.from({ length: 10 }, (_, index) => ({
            key: `nested-pre-${index}`,
            type: 'source'
        }));
        const nestedPost = Array.from({ length: 6 }, (_, index) => ({
            key: `nested-post-${index}`,
            type: 'source'
        }));
        const nestedSelected = [
            ...[0, 2, 4, 6, 8].map((index) => `nested-pre-${index}`),
            ...nestedGroupOne.map((item) => item.key),
            'nested-root-middle',
            ...nestedGroupTwo.map((item) => item.key),
            ...[0, 2, 4, 5].map((index) => `nested-post-${index}`)
        ];

        const scenarios = [
            {
                name: 'first content-box source',
                nodes: flatNodes,
                selectedKeys: ['flat-first'],
                expectedRunCount: 1,
                expectedUnfoldHeight: 38
            },
            {
                name: 'middle border-box source',
                nodes: flatNodes,
                selectedKeys: ['flat-middle'],
                expectedRunCount: 1,
                expectedUnfoldHeight: 48
            },
            {
                name: 'last source',
                nodes: flatNodes,
                selectedKeys: ['flat-last'],
                expectedRunCount: 1
            },
            {
                name: 'contiguous multi source',
                nodes: flatNodes,
                selectedKeys: ['flat-first', 'flat-middle'],
                expectedRunCount: 1
            },
            {
                name: 'non-contiguous multi source',
                nodes: flatNodes,
                selectedKeys: ['flat-first', 'flat-last'],
                expectedRunCount: 2
            },
            {
                name: 'mixed source and group',
                nodes: [
                    {
                        key: 'mixed-source',
                        type: 'source',
                        marginBottom: 8
                    },
                    {
                        key: 'mixed-group',
                        type: 'group',
                        children: [
                            { key: 'mixed-child-a', type: 'source' },
                            { key: 'mixed-child-b', type: 'source' }
                        ]
                    },
                    {
                        key: 'mixed-survivor',
                        type: 'source',
                        marginTop: 16
                    }
                ],
                selectedKeys: ['mixed-source', 'mixed-group'],
                expectedRunCount: 1,
                preview: {
                    siblingKeys: ['mixed-source', 'mixed-group', 'mixed-survivor'],
                    insertIndex: 2,
                    shiftedKeys: ['mixed-survivor']
                }
            },
            {
                name: 'terminal nested-only source in a fixed final root group',
                nodes: [
                    { key: 'terminal-root-pre', type: 'source' },
                    {
                        key: 'terminal-final-group',
                        type: 'group',
                        childrenHeight: 96,
                        childrenOverflow: 'hidden',
                        children: [
                            {
                                key: 'terminal-child-pre',
                                type: 'source',
                                marginTop: 0,
                                marginBottom: 0
                            },
                            {
                                key: 'terminal-child-drag',
                                type: 'source',
                                marginTop: 0,
                                marginBottom: 0
                            }
                        ]
                    }
                ],
                selectedKeys: ['terminal-child-drag'],
                expectedRunCount: 1,
                expectedTotal: 48,
                preview: {
                    siblingKeys: ['terminal-child-pre', 'terminal-child-drag'],
                    insertIndex: 0,
                    shiftedKeys: ['terminal-child-pre']
                }
            },
            {
                name: 'fixed nested source plus later root source',
                nodes: [
                    {
                        key: 'contained-group',
                        type: 'group',
                        childrenHeight: 48,
                        childrenOverflow: 'hidden',
                        children: [
                            {
                                key: 'contained-child-drag',
                                type: 'source',
                                marginTop: 0,
                                marginBottom: 0
                            }
                        ]
                    },
                    {
                        key: 'contained-root-drag',
                        type: 'source',
                        marginTop: 0,
                        marginBottom: 0
                    },
                    {
                        key: 'contained-root-next',
                        type: 'source',
                        marginTop: 0,
                        marginBottom: 0
                    }
                ],
                selectedKeys: ['contained-child-drag', 'contained-root-drag'],
                expectedRunCount: 2,
                expectedTotal: 96,
                preview: {
                    siblingKeys: [
                        'contained-group',
                        'contained-root-drag',
                        'contained-root-next'
                    ],
                    insertIndex: 2,
                    shiftedKeys: ['contained-root-next']
                }
            },
            {
                name: 'root and two groups with 50 selected items',
                nodes: [
                    ...nestedPre,
                    {
                        key: 'nested-group-one',
                        type: 'group',
                        children: nestedGroupOne
                    },
                    { key: 'nested-root-middle', type: 'source' },
                    { key: 'nested-root-survivor', type: 'source' },
                    {
                        key: 'nested-group-two',
                        type: 'group',
                        children: nestedGroupTwo
                    },
                    ...nestedPost
                ],
                selectedKeys: nestedSelected,
                expectedRunCount: 11
            }
        ];

        for (const scenario of scenarios) {
            await page.emulateMedia({
                reducedMotion: scenario.name === 'last source' ? 'reduce' : 'no-preference'
            });
            await installSyntheticLayoutFixture(page, scenario.nodes);
            const prepared = await bridge(page, 'prepare', {
                draggedKeys: scenario.selectedKeys
            });

            expect.soft(
                prepared.session.probeMetrics.forcedLayoutReadPhases,
                `${scenario.name} forced read phases`
            ).toBeGreaterThan(0);
            expect.soft(
                prepared.session.probeMetrics.forcedLayoutReadPhases,
                `${scenario.name} forced read phase cap`
            ).toBeLessThanOrEqual(3);
            expect.soft(
                prepared.session.draggedRuns,
                `${scenario.name} run count`
            ).toHaveLength(scenario.expectedRunCount);
            expectRectMapsClose(prepared.afterRects, prepared.beforeRects);
            expect.soft(
                Math.abs(prepared.afterRootRect.height - prepared.beforeRootRect.height),
                `${scenario.name} root restore after prepare`
            ).toBeLessThanOrEqual(1);
            expect.soft(prepared.sentinelCount, `${scenario.name} sentinel cleanup`).toBe(0);

            if (scenario.expectedUnfoldHeight !== undefined) {
                const metric = new Map(prepared.session.itemMetrics).get(scenario.selectedKeys[0]);
                expect.soft(metric.unfoldHeight, `${scenario.name} unfold height`).toBe(
                    scenario.expectedUnfoldHeight
                );
            }

            await bridge(page, 'fold');
            const firstFoldSample = await bridge(page, 'snapshot');
            await page.waitForTimeout(90);
            const middleFoldSample = await bridge(page, 'snapshot');
            await page.waitForTimeout(150);
            const folded = await bridge(page, 'snapshot');
            for (const [index, sample] of [firstFoldSample, middleFoldSample, folded].entries()) {
                expect.soft(
                    sample.rootRect.height,
                    `${scenario.name} fold sample ${index} does not overshoot`
                ).toBeLessThanOrEqual(prepared.beforeRootRect.height + 1);
            }

            const actualFootprint = prepared.beforeRootRect.bottom - folded.rootRect.bottom;
            const expectedTotal = scenario.expectedTotal === undefined
                ? actualFootprint
                : scenario.expectedTotal;
            expect.soft(
                prepared.session.totalDraggedHeight,
                `${scenario.name} total footprint`
            ).toBeCloseTo(expectedTotal, 0);
            expect.soft(
                prepared.session.draggedRuns.reduce((sum, run) => sum + run.footprint, 0),
                `${scenario.name} run footprint sum`
            ).toBeCloseTo(expectedTotal, 0);
            expect.soft(folded.sentinelCount, `${scenario.name} folded sentinel cleanup`).toBe(0);

            if (scenario.preview) {
                const preview = await bridge(page, 'preview', scenario.preview);
                const shiftedKeys = new Set(scenario.preview.shiftedKeys);
                expect.soft(preview.shifts.map(([key]) => key).sort()).toEqual(
                    Array.from(shiftedKeys).sort()
                );
                for (const key of scenario.preview.siblingKeys) {
                    if (scenario.selectedKeys.includes(key)) continue;
                    const expectedDelta = shiftedKeys.has(key)
                        ? prepared.session.totalDraggedHeight
                        : 0;
                    expect.soft(
                        preview.rects[key].top - folded.rects[key].top,
                        `${scenario.name} preview delta for ${key}`
                    ).toBeCloseTo(expectedDelta, 0);
                }
                const cleared = await bridge(page, 'clear-preview');
                expectRectMapsClose(cleared.rects, folded.rects);
            }

            await bridge(page, 'unfold', {
                animated: scenario.name === 'last source'
            });
            if (scenario.name === 'last source') await page.waitForTimeout(240);
            const restored = await bridge(page, 'snapshot');
            expectRectMapsClose(restored.rects, prepared.beforeRects);
            expect.soft(restored.sentinelCount, `${scenario.name} restored sentinel cleanup`).toBe(0);
            expect.soft(
                restored.selectedAnimationCount,
                `${scenario.name} probe animation cleanup`
            ).toBe(0);
        }
    } finally {
        await closeExtensionContext(env);
        fs.rmSync(extensionRoot, { recursive: true, force: true });
    }
});

test('restores a bounded root scroll position after a terminal multi-row probe', async () => {
    const extensionRoot = createInstrumentedExtensionRoot();
    let env;
    try {
        env = await launchExtensionContext(extensionRoot);
        await installNotebookFixture(env.context);
        const extensionId = await waitForExtensionId(env.context, env.userDataDir, extensionRoot);
        await seedReflowPreference(env.context, extensionId);

        const page = await env.context.newPage();
        await page.goto('https://notebooklm.google.com/notebook/drag-reflow-bounded-scroll');
        await expect(page.locator('#sources-plus-root')).toBeVisible({ timeout: 20_000 });

        const nodes = Array.from({ length: 14 }, (_, index) => ({
            key: `scroll-row-${index}`,
            type: 'source',
            marginTop: 0,
            marginBottom: 0
        }));
        await installSyntheticLayoutFixture(page, nodes);
        const beforeScrollTop = await page.evaluate(() => {
            const root = document.querySelector('#sources-plus-root')
                .shadowRoot
                .querySelector('#sp-drag-layout-fixture');
            root.style.height = '160px';
            root.style.overflowY = 'auto';
            root.scrollTop = root.scrollHeight;
            return root.scrollTop;
        });
        expect(beforeScrollTop).toBeGreaterThan(0);

        const selectedKeys = nodes.slice(-8).map((node) => node.key);
        const prepared = await bridge(page, 'prepare', { draggedKeys: selectedKeys });

        expect.soft(prepared.beforeRootScrollTop).toBeCloseTo(beforeScrollTop, 0);
        expect.soft(prepared.afterRootScrollTop).toBeCloseTo(beforeScrollTop, 0);
        expectRectMapsClose(prepared.afterRects, prepared.beforeRects);
        expect.soft(prepared.session.totalDraggedHeight).toBeCloseTo(8 * 48, 0);
        expect.soft(prepared.session.probeMetrics.forcedLayoutReadPhases).toBeLessThanOrEqual(3);
        expect.soft(prepared.sentinelCount).toBe(0);
    } finally {
        await closeExtensionContext(env);
        fs.rmSync(extensionRoot, { recursive: true, force: true });
    }
});

test('keeps a trusted manager drag alive and restores its row after Escape and dragend', async () => {
    const extensionRoot = createInstrumentedExtensionRoot();
    let env;
    try {
        env = await launchExtensionContext(extensionRoot);
        await installNotebookFixture(env.context);
        const extensionId = await waitForExtensionId(env.context, env.userDataDir, extensionRoot);
        await seedReflowPreference(env.context, extensionId);

        const page = await env.context.newPage();
        await page.goto('https://notebooklm.google.com/notebook/drag-reflow-runtime');
        await expect(page.locator('#sources-plus-root')).toBeVisible({ timeout: 20_000 });
        await page.evaluate(() => window.__waitForFixtureHydration('full'));

        const rows = page.locator('#sources-plus-root .source-item');
        await expect(rows).toHaveCount(2, { timeout: 20_000 });
        await page.evaluate(() => {
            const root = document.querySelector('#sources-plus-root').shadowRoot;
            window.__dragReflowRuntimeEvents = [];
            root.addEventListener('dragstart', (event) => {
                window.__dragReflowRuntimeEvents.push({
                    type: 'dragstart',
                    trusted: event.isTrusted,
                    defaultPrevented: event.defaultPrevented
                });
            });
            root.addEventListener('dragend', (event) => {
                window.__dragReflowRuntimeEvents.push({
                    type: 'dragend',
                    trusted: event.isTrusted,
                    defaultPrevented: event.defaultPrevented
                });
            });
        });

        const before = await rows.nth(1).evaluate((row) => {
            const rect = row.getBoundingClientRect();
            const style = getComputedStyle(row);
            return {
                rect: {
                    top: rect.top,
                    bottom: rect.bottom,
                    height: rect.height
                },
                marginTop: style.marginTop,
                marginBottom: style.marginBottom,
                inlineHeight: row.style.getPropertyValue('height'),
                inlineOpacity: row.style.getPropertyValue('opacity'),
                draggable: row.draggable
            };
        });
        expect(before.draggable).toBe(true);

        const originBox = await rows.nth(1).boundingBox();
        const targetBox = await rows.first().boundingBox();
        if (!originBox || !targetBox) throw new Error('Manager drag rows are not visible.');
        await page.mouse.move(
            originBox.x + originBox.width / 2,
            originBox.y + originBox.height / 2
        );
        await page.mouse.down();
        await page.mouse.move(
            originBox.x + originBox.width / 2 + 8,
            originBox.y + originBox.height / 2 + 8,
            { steps: 4 }
        );
        await page.mouse.move(
            targetBox.x + targetBox.width / 2,
            targetBox.y + targetBox.height - 2,
            { steps: 12 }
        );

        await expect.poll(async () => page.evaluate(() => (
            window.__dragReflowRuntimeEvents.some((event) => (
                event.type === 'dragstart' && event.trusted
            ))
        )), { timeout: 10_000 }).toBe(true);
        const trustedDragStart = await page.evaluate(() => (
            window.__dragReflowRuntimeEvents.find((event) => (
                event.type === 'dragstart' && event.trusted
            ))
        ));
        expect.soft(trustedDragStart.defaultPrevented).toBe(false);
        await expect.poll(async () => page.evaluate(() => {
            const root = document.querySelector('#sources-plus-root').shadowRoot;
            return root.querySelectorAll('.sp-drag-folded').length;
        }), { timeout: 10_000 }).toBeGreaterThan(0);

        await page.waitForTimeout(240);
        const currentTargetBox = await rows.first().boundingBox();
        if (!currentTargetBox) throw new Error('Manager drag target disappeared after fold.');
        await page.mouse.move(
            currentTargetBox.x + currentTargetBox.width / 2,
            currentTargetBox.y + currentTargetBox.height - 2,
            { steps: 4 }
        );
        await page.evaluate(() => {
            const root = document.querySelector('#sources-plus-root').shadowRoot;
            const origin = root.querySelector('.source-item.sp-drag-folded');
            const target = Array.from(root.querySelectorAll('.source-item')).find(
                (row) => row !== origin
            );
            if (!origin || !target) throw new Error('Synthetic preview target is unavailable.');
            const dataTransfer = new DataTransfer();
            dataTransfer.setData('application/source-key', origin.dataset.sourceKey);
            const rect = target.getBoundingClientRect();
            target.dispatchEvent(new DragEvent('dragover', {
                bubbles: true,
                cancelable: true,
                dataTransfer,
                clientX: rect.left + rect.width / 2,
                clientY: rect.top + 2
            }));
        });
        await page.waitForTimeout(50);
        const folded = await page.evaluate(() => {
            const root = document.querySelector('#sources-plus-root').shadowRoot;
            const row = root.querySelector('.source-item.sp-drag-folded');
            const rect = row?.getBoundingClientRect();
            return {
                foldedCount: root.querySelectorAll('.sp-drag-folded').length,
                shiftedCount: root.querySelectorAll('.sp-drop-shift').length,
                height: rect?.height || 0,
                animations: row?.getAnimations().length || 0
            };
        });
        expect(folded.foldedCount).toBeGreaterThan(0);
        expect(folded.height).toBeLessThanOrEqual(1);
        expect(folded.shiftedCount).toBeGreaterThan(0);
        expect(folded.animations).toBe(0);

        await page.keyboard.press('Escape');
        await expect.poll(async () => page.evaluate(() => (
            window.__dragReflowRuntimeEvents.some((event) => (
                event.type === 'dragend' && event.trusted
            ))
        )), { timeout: 10_000 }).toBe(true);
        await page.mouse.up();
        await page.waitForTimeout(280);

        const restored = await rows.nth(1).evaluate((row) => {
            const root = row.getRootNode();
            const rect = row.getBoundingClientRect();
            const style = getComputedStyle(row);
            return {
                rect: {
                    top: rect.top,
                    bottom: rect.bottom,
                    height: rect.height
                },
                marginTop: style.marginTop,
                marginBottom: style.marginBottom,
                inlineHeight: row.style.getPropertyValue('height'),
                inlineOpacity: row.style.getPropertyValue('opacity'),
                layoutAnimations: row.getAnimations().filter((animation) => (
                    [
                        'height',
                        'opacity',
                        'margin-top',
                        'margin-bottom',
                        'padding-top',
                        'padding-bottom',
                        'border-top-width',
                        'border-bottom-width'
                    ].includes(animation.transitionProperty || '')
                )).length,
                foldedCount: root.querySelectorAll('.sp-drag-folded').length,
                unfoldingCount: root.querySelectorAll('.sp-drag-unfolding').length,
                shiftedCount: root.querySelectorAll('.sp-drop-shift').length
            };
        });
        expect.soft(Math.abs(restored.rect.height - before.rect.height)).toBeLessThanOrEqual(1);
        expect.soft(restored.marginTop).toBe(before.marginTop);
        expect.soft(restored.marginBottom).toBe(before.marginBottom);
        expect.soft(restored.inlineHeight).toBe(before.inlineHeight);
        expect.soft(restored.inlineOpacity).toBe(before.inlineOpacity);
        expect.soft(restored.layoutAnimations).toBe(0);
        expect.soft(restored.foldedCount).toBe(0);
        expect.soft(restored.unfoldingCount).toBe(0);
        expect.soft(restored.shiftedCount).toBe(0);
    } finally {
        await closeExtensionContext(env);
        fs.rmSync(extensionRoot, { recursive: true, force: true });
    }
});
