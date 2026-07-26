const os = require('os');
const path = require('path');
const fs = require('fs');

const { test, expect } = require('@playwright/test');

const {
    closeExtensionContext,
    launchExtensionContext,
    openExtensionPage,
    waitForExtensionId
} = require('./helpers/extension-context');
const { installNotebookFixture } = require('./helpers/notebooklm-fixture');

const repoRoot = path.resolve(__dirname, '../..');
const WARMUP_SESSIONS = 5;
const MEASURED_SESSIONS = 20;
const WARMUP_FRAMES = 10;
const MEASURED_FRAMES = 50;
const rowCounts = [100, 500];

test.skip(process.env.DRAG_BENCHMARK !== '1', 'Set DRAG_BENCHMARK=1 to run the opt-in drag benchmark.');

function createSyntheticSources(rowCount) {
    return Array.from({ length: rowCount }, (_, index) => {
        const number = String(index + 1).padStart(4, '0');
        return {
            id: `synthetic-source-${number}`,
            token: `synthetic-source-${number}`,
            title: `Synthetic source ${number}`
        };
    });
}

async function seedReflowPreference(context, extensionId) {
    const bridgePage = await openExtensionPage(context, extensionId, 'src/popup/popup.html');
    try {
        const response = await bridgePage.evaluate(async () => chrome.runtime.sendMessage({
            type: 'SAVE_PREFERENCES',
            preferences: {
                dragMode: 'reflow',
                welcomeOnboardingSeenVersion: 1
            }
        }));
        if (!response?.success) {
            throw new Error(`Could not enable reflow drag mode: ${response?.errorCode || 'unknown_error'}.`);
        }
    } finally {
        await bridgePage.close();
    }
}

function createContentInstrumentationScript() {
    function instrumentContentWorld() {
        if (globalThis.__NSM_DRAG_BENCHMARK_INSTALLED__) return;
        globalThis.__NSM_DRAG_BENCHMARK_INSTALLED__ = true;
        const state = {
            calls: { getBoundingClientRect: 0, querySelector: 0, querySelectorAll: 0 },
            domWrites: 0,
            geometryReadPendingAfterWrite: false,
            forcedLayoutReadPhases: 0,
            captureManagerFrames: false,
            frameSamples: [],
            rafScheduled: 0,
            rafCallbacks: 0,
            activeRafCallbacks: 0,
            domDeltaRafCallbacks: 0
        };
        const nativeDocumentQuerySelector = Document.prototype.querySelector;
        const nativeShadowRootQuerySelector = ShadowRoot.prototype.querySelector;
        const markWrite = () => {
            state.domWrites += 1;
            state.geometryReadPendingAfterWrite = true;
        };
        const originalRect = Element.prototype.getBoundingClientRect;
        Element.prototype.getBoundingClientRect = function instrumentedGetBoundingClientRect(...args) {
            state.calls.getBoundingClientRect += 1;
            if (state.geometryReadPendingAfterWrite) {
                state.forcedLayoutReadPhases += 1;
                state.geometryReadPendingAfterWrite = false;
            }
            return originalRect.apply(this, args);
        };
        for (const method of ['querySelector', 'querySelectorAll']) {
            const original = Element.prototype[method];
            Element.prototype[method] = function instrumentedQuery(...args) {
                state.calls[method] += 1;
                return original.apply(this, args);
            };
        }
        const nativeSetAttribute = Element.prototype.setAttribute;
        Element.prototype.setAttribute = function instrumentedSetAttribute(...args) {
            markWrite();
            return nativeSetAttribute.apply(this, args);
        };
        for (const method of ['add', 'remove', 'toggle', 'replace']) {
            const original = DOMTokenList.prototype[method];
            DOMTokenList.prototype[method] = function instrumentedClassWrite(...args) {
                markWrite();
                return original.apply(this, args);
            };
        }
        for (const method of ['setProperty', 'removeProperty']) {
            const original = CSSStyleDeclaration.prototype[method];
            CSSStyleDeclaration.prototype[method] = function instrumentedStyleWrite(...args) {
                markWrite();
                return original.apply(this, args);
            };
        }
        [
            'transform', 'height', 'transition', 'overflow', 'opacity',
            'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
            'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
            'borderWidth'
        ].forEach((property) => {
            const descriptor = Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, property);
            if (!descriptor || typeof descriptor.set !== 'function') return;
            Object.defineProperty(CSSStyleDeclaration.prototype, property, {
                configurable: descriptor.configurable,
                enumerable: descriptor.enumerable,
                get: descriptor.get,
                set(value) {
                    markWrite();
                    return descriptor.set.call(this, value);
                }
            });
        });
        const originalRaf = globalThis.requestAnimationFrame.bind(globalThis);
        globalThis.requestAnimationFrame = (callback) => {
            state.rafScheduled += 1;
            return originalRaf((timestamp) => {
                state.rafCallbacks += 1;
                const beforeCalls = { ...state.calls };
                const beforeWrites = state.domWrites;
                const start = performance.now();
                callback(timestamp);
                const duration = performance.now() - start;
                const domCounterDelta = state.domWrites !== beforeWrites
                    || state.calls.getBoundingClientRect !== beforeCalls.getBoundingClientRect
                    || state.calls.querySelector !== beforeCalls.querySelector
                    || state.calls.querySelectorAll !== beforeCalls.querySelectorAll;
                const rootHost = nativeDocumentQuerySelector.call(document, '#sources-plus-root');
                const shadowRoot = rootHost?.shadowRoot || null;
                const managerActive = Boolean(shadowRoot
                    && nativeShadowRootQuerySelector.call(shadowRoot, '#sources-list.sp-drag-active'));
                if (managerActive) state.activeRafCallbacks += 1;
                if (domCounterDelta) state.domDeltaRafCallbacks += 1;
                if (state.captureManagerFrames && managerActive && domCounterDelta) {
                    state.frameSamples.push(duration);
                }
            });
        };
        const getHost = () => nativeDocumentQuerySelector.call(document, '#sources-plus-root');
        document.addEventListener('sources-plus-drag-benchmark-command', () => {
            const host = getHost();
            if (!host) return;
            const command = host.getAttribute('data-drag-benchmark-command');
            if (command === 'reset') {
                state.calls = { getBoundingClientRect: 0, querySelector: 0, querySelectorAll: 0 };
                state.domWrites = 0;
                state.geometryReadPendingAfterWrite = false;
                state.forcedLayoutReadPhases = 0;
                state.frameSamples = [];
                state.rafScheduled = 0;
                state.rafCallbacks = 0;
                state.activeRafCallbacks = 0;
                state.domDeltaRafCallbacks = 0;
            } else if (command === 'reset-frames') {
                state.frameSamples = [];
            } else if (command === 'capture-frames') {
                state.captureManagerFrames = host.getAttribute('data-drag-benchmark-capture') === 'true';
            }
            nativeSetAttribute.call(host, 'data-drag-benchmark-result', JSON.stringify({
                calls: state.calls,
                forcedLayoutReadPhases: state.forcedLayoutReadPhases,
                frameSamples: state.frameSamples,
                rafScheduled: state.rafScheduled,
                rafCallbacks: state.rafCallbacks,
                activeRafCallbacks: state.activeRafCallbacks,
                domDeltaRafCallbacks: state.domDeltaRafCallbacks
            }));
        });
    }

    return `(${instrumentContentWorld.toString()})();\n`;
}

function createBenchmarkExtensionRoot() {
    const benchmarkRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gemininotebook-drag-benchmark-'));
    const manifestPath = path.join(benchmarkRoot, 'manifest.json');
    fs.cpSync(path.join(repoRoot, 'manifest.json'), manifestPath);
    fs.cpSync(path.join(repoRoot, 'src'), path.join(benchmarkRoot, 'src'), { recursive: true });
    fs.cpSync(path.join(repoRoot, '_locales'), path.join(benchmarkRoot, '_locales'), { recursive: true });
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const instrumentationFilename = 'benchmark-drag-instrumentation.js';
    fs.writeFileSync(path.join(benchmarkRoot, instrumentationFilename), createContentInstrumentationScript(), 'utf8');
    manifest.content_scripts[0].js.unshift(instrumentationFilename);
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    return benchmarkRoot;
}

test.describe.serial('drag performance baseline', () => {
    test.setTimeout(180_000);

    test('records deterministic 100 and 500-row reflow samples', async () => {
        const benchmarkExtensionRoot = createBenchmarkExtensionRoot();
        let env;
        try {
            env = await launchExtensionContext(benchmarkExtensionRoot);
            await installNotebookFixture(env.context);
            const extensionId = await waitForExtensionId(env.context, env.userDataDir, benchmarkExtensionRoot);
            await seedReflowPreference(env.context, extensionId);
            const allResults = [];
            for (const rowCount of rowCounts) {
                const page = await env.context.newPage();
                page.on('dialog', (dialog) => dialog.accept('Benchmark group').catch(() => {}));
                await page.goto(`https://notebooklm.google.com/notebook/drag-benchmark-${rowCount}`);
                await expect(page.locator('#sources-plus-root')).toBeVisible({ timeout: 20_000 });

                const results = await page.evaluate(async ({ nextRowCount, sources, warmupSessions, measuredSessions, warmupFrames, measuredFrames }) => {
                    const getRoot = () => document.querySelector('#sources-plus-root')?.shadowRoot || null;
                    const benchmarkBridge = (command, capture = null) => {
                        const host = document.querySelector('#sources-plus-root');
                        if (!host) throw new Error('Benchmark host missing.');
                        host.setAttribute('data-drag-benchmark-command', command);
                        if (capture !== null) host.setAttribute('data-drag-benchmark-capture', capture ? 'true' : 'false');
                        host.dispatchEvent(new Event('sources-plus-drag-benchmark-command', {
                            bubbles: true,
                            composed: true
                        }));
                        const raw = host.getAttribute('data-drag-benchmark-result');
                        if (!raw) throw new Error(`Benchmark command ${command} did not return a result.`);
                        return JSON.parse(raw);
                    };
                    const wait = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
                    const nextFrame = () => new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
                    let sourceKeysByNumber = null;
                    const sourceKey = (number) => {
                        const key = sourceKeysByNumber?.get(number);
                        if (!key) throw new Error(`Synthetic source key ${number} was not resolved.`);
                        return key;
                    };
                    const percentile = (values, fraction) => {
                        const sorted = values.slice().sort((left, right) => left - right);
                        const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1));
                        return Number(sorted[index].toFixed(3));
                    };
                    const waitFor = async (read, message, timeoutMs = 30_000) => {
                        const deadline = performance.now() + timeoutMs;
                        while (performance.now() < deadline) {
                            const value = read();
                            if (value) return value;
                            await wait(25);
                        }
                        throw new Error(message);
                    };
                    const rowFor = (key) => getRoot()?.querySelector(`.source-item[data-source-key="${key}"]`) || null;
                    const dispatchDrag = (row, type, extra = {}) => {
                        const event = new DragEvent(type, {
                            bubbles: true,
                            cancelable: true,
                            dataTransfer: extra.dataTransfer || new DataTransfer(),
                            clientX: extra.clientX || 12,
                            clientY: extra.clientY || 12
                        });
                        row.dispatchEvent(event);
                        return event.dataTransfer;
                    };
                    const enableBatch = async () => {
                        const root = getRoot();
                        if (root?.querySelector('.sp-batch-checkbox')) return;
                        root.querySelector('#sp-batch-action-btn')?.click();
                        await waitFor(() => getRoot()?.querySelectorAll('.sp-batch-checkbox').length > 0, 'Batch mode did not enable.');
                    };
                    const disableBatch = async () => {
                        const root = getRoot();
                        if (!root?.querySelector('.sp-batch-checkbox')) return;
                        root.querySelector('#sp-batch-action-btn')?.click();
                        await waitFor(() => getRoot()?.querySelectorAll('.sp-batch-checkbox').length === 0, 'Batch mode did not disable.');
                    };
                    const selectKeys = async (keys) => {
                        for (const key of keys) {
                            const checkbox = rowFor(key)?.querySelector('.sp-batch-checkbox');
                            if (!checkbox) throw new Error(`Batch checkbox missing for ${key}.`);
                            checkbox.click();
                        }
                        await nextFrame();
                        const selected = Array.from(getRoot()?.querySelectorAll('.source-item.selected-for-batch') || [])
                            .map((row) => row.dataset.sourceKey)
                            .filter(Boolean);
                        if (selected.length !== keys.length || keys.some((key) => !selected.includes(key))) {
                            throw new Error(`Expected selected keys ${keys.join(',')}; saw ${selected.join(',')}.`);
                        }
                    };
                    const createGroups = async () => {
                        for (let index = 1; index <= 2; index += 1) {
                            const button = getRoot()?.querySelector('#sp-new-group-btn');
                            if (!button) throw new Error('New group button missing.');
                            button.click();
                            await waitFor(() => getRoot()?.querySelectorAll('#sources-list > .group-container').length === index,
                                `Benchmark group ${index} did not render.`);
                        }
                        return Array.from(getRoot()?.querySelectorAll('#sources-list > .group-container') || [])
                            .map((group) => group.dataset.groupId)
                            .filter(Boolean);
                    };
                    const moveSelectionIntoGroup = async (keys, groupId) => {
                        await enableBatch();
                        await selectKeys(keys);
                        const origin = rowFor(keys[0]);
                        const target = getRoot()?.querySelector(`.group-container[data-group-id="${groupId}"]`);
                        if (!origin || !target) throw new Error('Benchmark distribution target missing.');
                        const dataTransfer = dispatchDrag(origin, 'dragstart');
                        target.classList.add('drag-into');
                        const rect = target.getBoundingClientRect();
                        dispatchDrag(target, 'drop', {
                            dataTransfer,
                            clientX: Math.floor(rect.left + rect.width * 0.75),
                            clientY: Math.floor(rect.top + rect.height / 2)
                        });
                        dispatchDrag(origin, 'dragend', { dataTransfer });
                        await wait(30);
                        await nextFrame();
                        await disableBatch();
                    };
                    const runPrepare = async (originKey, record) => {
                        const origin = rowFor(originKey);
                        if (!origin) throw new Error(`Benchmark origin ${originKey} missing.`);
                        const startForced = benchmarkBridge('snapshot').forcedLayoutReadPhases;
                        const start = performance.now();
                        const dataTransfer = dispatchDrag(origin, 'dragstart');
                        const cpuMs = performance.now() - start;
                        await nextFrame();
                        dispatchDrag(origin, 'dragend', { dataTransfer });
                        await nextFrame();
                        await wait(5);
                        if (record) {
                            record.cpu.push(cpuMs);
                            record.forced.push(benchmarkBridge('snapshot').forcedLayoutReadPhases - startForced);
                        }
                    };
                    const runCallbackFrames = async (originKey, frameCount) => {
                        const origin = rowFor(originKey);
                        if (!origin) throw new Error(`Frame benchmark origin ${originKey} missing.`);
                        const dataTransfer = dispatchDrag(origin, 'dragstart');
                        await nextFrame();
                        benchmarkBridge('reset-frames');
                        benchmarkBridge('capture-frames', true);
                        const listRect = getRoot()?.querySelector('#sources-list')?.getBoundingClientRect();
                        const candidates = Array.from(getRoot()?.querySelectorAll('.source-item:not(.selected-for-batch)') || [])
                            .filter((candidate) => {
                                const rect = candidate.getBoundingClientRect();
                                return listRect && rect.bottom > listRect.top && rect.top < listRect.bottom;
                            })
                            .slice(0, 12);
                        if (candidates.length < 2) throw new Error('Not enough non-selected benchmark drag targets.');
                        let captured = 0;
                        let attempts = 0;
                        while (captured < frameCount && attempts < frameCount * 3) {
                            const previousSampleCount = benchmarkBridge('snapshot').frameSamples.length;
                            const target = candidates[(attempts * 17 + 7) % candidates.length];
                            const rect = target.getBoundingClientRect();
                            dispatchDrag(target, 'dragover', {
                                dataTransfer,
                                clientX: Math.floor(rect.left + rect.width / 2),
                                clientY: Math.floor(rect.top + rect.height / 2)
                            });
                            // The page and extension isolated worlds have distinct rAF queues.
                            // Wait for this exact queued content callback to acknowledge itself
                            // before allowing the next dragover to replace pending args.
                            let acknowledged = false;
                            for (let frame = 0; frame < 12; frame += 1) {
                                await nextFrame();
                                if (benchmarkBridge('snapshot').frameSamples.length === previousSampleCount + 1) {
                                    acknowledged = true;
                                    break;
                                }
                            }
                            attempts += 1;
                            if (acknowledged) captured += 1;
                        }
                        if (captured !== frameCount) {
                            const diagnostics = benchmarkBridge('snapshot');
                            throw new Error(`Expected ${frameCount} qualifying manager-active callbacks, captured ${captured} from ${attempts} target callbacks; rAF ${diagnostics.rafCallbacks}/${diagnostics.rafScheduled}, active ${diagnostics.activeRafCallbacks}, delta ${diagnostics.domDeltaRafCallbacks}.`);
                        }
                        const frames = benchmarkBridge('capture-frames', false).frameSamples;
                        dispatchDrag(origin, 'dragend', { dataTransfer });
                        await nextFrame();
                        return frames.slice(0, frameCount);
                    };
                    const benchmarkSelection = async ({ selectionCount, originKey, selectedKeys }) => {
                        if (selectionCount === 50) {
                            await enableBatch();
                            await selectKeys(selectedKeys);
                        }
                        const prepare = { cpu: [], forced: [] };
                        for (let index = 0; index < warmupSessions; index += 1) await runPrepare(originKey, null);
                        benchmarkBridge('reset');
                        for (let index = 0; index < measuredSessions; index += 1) await runPrepare(originKey, prepare);
                        const prepareCalls = benchmarkBridge('snapshot').calls;
                        // Earlier synthetic dragend calls schedule the production pseudo-hover
                        // backstop for 1500ms. Let those old sessions finish before timing one
                        // continuous active-drag sequence, otherwise an old cleanup can remove
                        // the current list's manager-active marker mid-sample.
                        await wait(1600);
                        const warmup = await runCallbackFrames(originKey, warmupFrames);
                        if (warmup.length === 0) throw new Error('Manager-active drag callback warmup was not captured.');
                        await wait(1600);
                        benchmarkBridge('reset');
                        const frames = await runCallbackFrames(originKey, measuredFrames);
                        const callbackCalls = benchmarkBridge('snapshot').calls;
                        if (frames.length < measuredFrames) {
                            const diagnostics = benchmarkBridge('snapshot');
                            throw new Error(`Expected ${measuredFrames} manager-active callback samples, saw ${frames.length}; rAF ${diagnostics.rafCallbacks}/${diagnostics.rafScheduled}, active ${diagnostics.activeRafCallbacks}, delta ${diagnostics.domDeltaRafCallbacks}.`);
                        }
                        return {
                            rowCount: nextRowCount,
                            selectionCount,
                            warmupSessions,
                            measuredSessions,
                            warmupFrames,
                            measuredFrames,
                            prepareCpuMs: {
                                p50: percentile(prepare.cpu, 0.5),
                                p95: percentile(prepare.cpu, 0.95)
                            },
                            prepareForcedLayoutReadPhases: { max: Math.max(...prepare.forced) },
                            callbackCpuMs: {
                                p50: percentile(frames, 0.5),
                                p95: percentile(frames, 0.95)
                            },
                            calls: {
                                getBoundingClientRect: prepareCalls.getBoundingClientRect + callbackCalls.getBoundingClientRect,
                                querySelector: prepareCalls.querySelector + callbackCalls.querySelector,
                                querySelectorAll: prepareCalls.querySelectorAll + callbackCalls.querySelectorAll
                            }
                        };
                    };

                    window.__swapNotebook({ notebookId: `drag-benchmark-${nextRowCount}`, sources });
                    await waitFor(() => getRoot()?.querySelectorAll('#sources-list .source-item').length === nextRowCount,
                        `Manager did not render ${nextRowCount} synthetic sources.`);
                    sourceKeysByNumber = new Map(Array.from(getRoot()?.querySelectorAll('#sources-list .source-item') || [])
                        .map((row) => {
                            const title = row.querySelector('.source-title-text')?.textContent || '';
                            const match = title.match(/^Synthetic source (\d{4})$/);
                            return match && row.dataset.sourceKey ? [Number(match[1]), row.dataset.sourceKey] : null;
                        })
                        .filter(Boolean));
                    if (sourceKeysByNumber.size !== nextRowCount) {
                        throw new Error(`Expected ${nextRowCount} deterministic source keys, saw ${sourceKeysByNumber.size}.`);
                    }
                    const groupIds = await createGroups();
                    for (let index = 0; index < 2; index += 1) {
                        const first = index * 10 + 1;
                        await moveSelectionIntoGroup(Array.from({ length: 10 }, (_, offset) => sourceKey(first + offset)), groupIds[index]);
                    }
                    const distributed = groupIds.flatMap((groupId) => Array.from(
                        getRoot()?.querySelectorAll(`.group-container[data-group-id="${groupId}"] .source-item`) || []
                    ).map((row) => row.dataset.sourceKey).filter(Boolean));
                    if (distributed.length !== 20) throw new Error(`Expected 20 grouped benchmark sources, saw ${distributed.length}.`);

                    const rootOrigin = sourceKey(nextRowCount === 100 ? 91 : 491);
                    const multiOrigin = sourceKey(41);
                    const mixedSelection = [
                        ...Array.from({ length: 20 }, (_, index) => sourceKey(index + 1)),
                        ...Array.from({ length: 15 }, (_, index) => sourceKey(index + 41)),
                        ...Array.from({ length: 15 }, (_, index) => sourceKey(index + 71))
                    ];
                    const single = await benchmarkSelection({ selectionCount: 1, originKey: rootOrigin, selectedKeys: [] });
                    const multi = await benchmarkSelection({ selectionCount: 50, originKey: multiOrigin, selectedKeys: mixedSelection });
                    return {
                        environment: {
                            userAgent: navigator.userAgent,
                            platform: navigator.platform,
                            logicalProcessors: navigator.hardwareConcurrency || null
                        },
                        results: [single, multi]
                    };
                }, {
                    nextRowCount: rowCount,
                    sources: createSyntheticSources(rowCount),
                    warmupSessions: WARMUP_SESSIONS,
                    measuredSessions: MEASURED_SESSIONS,
                    warmupFrames: WARMUP_FRAMES,
                    measuredFrames: MEASURED_FRAMES
                });

                expect(results.results).toHaveLength(2);
                results.results.forEach((result) => {
                    expect(result.prepareCpuMs.p50).toBeGreaterThanOrEqual(0);
                    expect(result.callbackCpuMs.p95).toBeGreaterThanOrEqual(0);
                    expect(result.calls.getBoundingClientRect).toBeGreaterThan(0);
                });
                console.log('DRAG_BENCHMARK_RESULT', JSON.stringify({
                    environment: {
                        ...results.environment,
                        nodePlatform: process.platform,
                        cpuModel: os.cpus()?.[0]?.model || 'unknown'
                    },
                    results: results.results
                }));
                allResults.push(...results.results);
                await page.close();
            }
            expect(allResults).toHaveLength(rowCounts.length * 2);
        } finally {
            if (env) await closeExtensionContext(env);
            fs.rmSync(benchmarkExtensionRoot, { recursive: true, force: true });
        }
    });
});
