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
const createContentDragMulti = require('../../src/content/content-drag-multi.js');
const manifest = require('../../manifest.json');

const repoRoot = path.resolve(__dirname, '../..');
const WARMUP_SESSIONS = 5;
const MEASURED_SESSIONS = 20;
const WARMUP_FRAMES = 10;
const MEASURED_FRAMES = 50;
const autoScrollEdgePx = createContentDragMulti({}).EDGE_PX;
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
        const response = await bridgePage.evaluate(async (version) => chrome.runtime.sendMessage({
            type: 'SAVE_PREFERENCES',
            preferences: {
                dragMode: 'reflow',
                welcomeOnboardingSeenVersion: 1,
                whatsNewSeenVersion: version
            }
        }), manifest.version);
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
        // This temporary extension copy exposes index.js's Jest test surface to
        // the isolated content world; the packaged extension has no module global.
        globalThis.module = { exports: {} };
        let activeHandle = null;
        let activeSourceKey = null;
        document.addEventListener('sources-plus-drag-benchmark-pointer-command', () => {
            const host = document.querySelector('#sources-plus-root');
            const args = JSON.parse(host?.getAttribute('data-drag-benchmark-pointer-args') || '{}');
            const api = globalThis.module?.exports;
            const root = host?.shadowRoot;
            if (!host) return;
            if (!api || !root) {
                host.setAttribute('data-drag-benchmark-pointer-result', JSON.stringify({
                    error: 'Benchmark pointer bridge lacks module API or ShadowRoot.'
                }));
                return;
            }
            let result = false;
            try {
                if (args.command === 'prepare') {
                    activeHandle = root.querySelector(
                        `.source-item[data-source-key="${CSS.escape(args.sourceKey)}"] .sp-drag-handle`
                    );
                    activeSourceKey = args.sourceKey;
                    result = Boolean(activeHandle?.isConnected && !activeHandle.disabled);
                } else if (args.command === 'start') {
                    if (!activeHandle || activeSourceKey !== args.sourceKey) {
                        throw new Error('Benchmark pointer origin was not prepared.');
                    }
                    result = api._startDragForTest({ ...args, handle: activeHandle });
                    if (result !== true) activeHandle = null;
                } else if (args.command === 'update') {
                    result = api._updateDragForTest({ ...args, handle: activeHandle });
                } else if (args.command === 'commit') {
                    result = api._commitDragForTest({ ...args, handle: activeHandle });
                    activeHandle = null;
                    activeSourceKey = null;
                } else if (args.command === 'cancel') {
                    api._cancelDragForTest(args.reason || 'benchmark');
                    activeHandle = null;
                    activeSourceKey = null;
                    result = true;
                }
                host.setAttribute('data-drag-benchmark-pointer-result', JSON.stringify({ result }));
            } catch (error) {
                activeHandle = null;
                activeSourceKey = null;
                host.setAttribute('data-drag-benchmark-pointer-result', JSON.stringify({
                    error: String(error?.message || error)
                }));
            }
        });
        const state = {
            calls: { getBoundingClientRect: 0, querySelector: 0, querySelectorAll: 0 },
            geometryReads: { getBoundingClientRect: 0, offsetHeight: 0 },
            domWrites: 0,
            geometryReadPendingAfterWrite: false,
            forcedLayoutReadPhases: 0,
            captureManagerFrames: false,
            expectedFrameCallbackIds: new Set(),
            frameSamples: [],
            nextRafCallbackId: 1,
            scheduledCallbackIds: [],
            completedCallbackIds: [],
            activeRafCallbacks: 0,
            domDeltaRafCallbacks: 0
        };
        const nativeDocumentQuerySelector = Document.prototype.querySelector;
        const nativeShadowRootQuerySelector = ShadowRoot.prototype.querySelector;
        const copyCalls = () => ({ ...state.calls });
        const subtractCalls = (after, before) => ({
            getBoundingClientRect: after.getBoundingClientRect - before.getBoundingClientRect,
            querySelector: after.querySelector - before.querySelector,
            querySelectorAll: after.querySelectorAll - before.querySelectorAll
        });
        const markWrite = () => {
            state.domWrites += 1;
            state.geometryReadPendingAfterWrite = true;
        };
        const recordGeometryRead = (kind) => {
            state.geometryReads[kind] += 1;
            if (state.geometryReadPendingAfterWrite) {
                state.forcedLayoutReadPhases += 1;
                state.geometryReadPendingAfterWrite = false;
            }
        };
        const sameNodes = (left, right) => left.length === right.length
            && left.every((node, index) => node === right[index]);
        const childSnapshot = (node) => Array.from(node?.childNodes || []);
        const installStructuralNodeMethod = (method) => {
            const original = Node.prototype[method];
            if (typeof original !== 'function') return;
            Node.prototype[method] = function instrumentedStructuralNodeMethod(...args) {
                const sourceParent = args[0]?.parentNode || null;
                const targetBefore = childSnapshot(this);
                const sourceBefore = sourceParent && sourceParent !== this
                    ? childSnapshot(sourceParent)
                    : null;
                const result = original.apply(this, args);
                const targetChanged = !sameNodes(targetBefore, childSnapshot(this));
                const sourceChanged = sourceParent && sourceParent !== this && sourceBefore
                    ? !sameNodes(sourceBefore, childSnapshot(sourceParent))
                    : false;
                if (targetChanged || sourceChanged) markWrite();
                return result;
            };
        };
        for (const method of ['appendChild', 'insertBefore', 'removeChild', 'replaceChild']) {
            installStructuralNodeMethod(method);
        }
        const installStructuralElementMethod = (method) => {
            const original = Element.prototype[method];
            if (typeof original !== 'function') return;
            Element.prototype[method] = function instrumentedStructuralElementMethod(...args) {
                const before = childSnapshot(this);
                const result = original.apply(this, args);
                if (!sameNodes(before, childSnapshot(this))) markWrite();
                return result;
            };
        };
        for (const method of ['append', 'prepend', 'replaceChildren']) {
            installStructuralElementMethod(method);
        }
        const nativeElementRemove = Element.prototype.remove;
        if (typeof nativeElementRemove === 'function') {
            Element.prototype.remove = function instrumentedElementRemove(...args) {
                const parentBefore = this.parentNode;
                const result = nativeElementRemove.apply(this, args);
                if (parentBefore && this.parentNode !== parentBefore) markWrite();
                return result;
            };
        }
        const originalRect = Element.prototype.getBoundingClientRect;
        Element.prototype.getBoundingClientRect = function instrumentedGetBoundingClientRect(...args) {
            state.calls.getBoundingClientRect += 1;
            recordGeometryRead('getBoundingClientRect');
            return originalRect.apply(this, args);
        };
        const offsetHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
        if (!offsetHeightDescriptor || typeof offsetHeightDescriptor.get !== 'function') {
            throw new Error('Benchmark requires HTMLElement.prototype.offsetHeight instrumentation.');
        }
        Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
            configurable: offsetHeightDescriptor.configurable,
            enumerable: offsetHeightDescriptor.enumerable,
            get: function instrumentedOffsetHeight() {
                recordGeometryRead('offsetHeight');
                return offsetHeightDescriptor.get.call(this);
            }
        });
        for (const method of ['querySelector', 'querySelectorAll']) {
            const original = Element.prototype[method];
            Element.prototype[method] = function instrumentedQuery(...args) {
                state.calls[method] += 1;
                return original.apply(this, args);
            };
        }
        const nativeSetAttribute = Element.prototype.setAttribute;
        Element.prototype.setAttribute = function instrumentedSetAttribute(...args) {
            const name = args[0];
            const hadBefore = this.hasAttribute(name);
            const valueBefore = this.getAttribute(name);
            const result = nativeSetAttribute.apply(this, args);
            if (hadBefore !== this.hasAttribute(name) || valueBefore !== this.getAttribute(name)) {
                markWrite();
            }
            return result;
        };
        const nativeRemoveAttribute = Element.prototype.removeAttribute;
        Element.prototype.removeAttribute = function instrumentedRemoveAttribute(...args) {
            const name = args[0];
            const hadBefore = this.hasAttribute(name);
            const result = nativeRemoveAttribute.apply(this, args);
            if (hadBefore && !this.hasAttribute(name)) markWrite();
            return result;
        };
        const nativeToggleAttribute = Element.prototype.toggleAttribute;
        if (typeof nativeToggleAttribute === 'function') {
            Element.prototype.toggleAttribute = function instrumentedToggleAttribute(...args) {
                const name = args[0];
                const hadBefore = this.hasAttribute(name);
                const result = nativeToggleAttribute.apply(this, args);
                if (hadBefore !== this.hasAttribute(name)) markWrite();
                return result;
            };
        }
        for (const method of ['add', 'remove', 'toggle', 'replace']) {
            const original = DOMTokenList.prototype[method];
            DOMTokenList.prototype[method] = function instrumentedClassWrite(...args) {
                const before = this.value;
                const result = original.apply(this, args);
                if (before !== this.value) markWrite();
                return result;
            };
        }
        for (const method of ['setProperty', 'removeProperty']) {
            const original = CSSStyleDeclaration.prototype[method];
            CSSStyleDeclaration.prototype[method] = function instrumentedStyleWrite(...args) {
                const before = this.cssText;
                const result = original.apply(this, args);
                if (before !== this.cssText) markWrite();
                return result;
            };
        }
        [
            'transform', 'height', 'transition', 'overflow', 'opacity',
            'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
            'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
            'borderWidth', 'cssText'
        ].forEach((property) => {
            const descriptor = Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, property);
            if (!descriptor || typeof descriptor.set !== 'function') return;
            Object.defineProperty(CSSStyleDeclaration.prototype, property, {
                configurable: descriptor.configurable,
                enumerable: descriptor.enumerable,
                get: descriptor.get,
                set(value) {
                    const before = this.cssText;
                    const result = descriptor.set.call(this, value);
                    if (before !== this.cssText) markWrite();
                    return result;
                }
            });
        });
        const originalRaf = globalThis.requestAnimationFrame.bind(globalThis);
        globalThis.requestAnimationFrame = (callback) => {
            const callbackId = state.nextRafCallbackId;
            state.nextRafCallbackId += 1;
            state.scheduledCallbackIds.push(callbackId);
            return originalRaf((timestamp) => {
                const beforeCalls = copyCalls();
                const beforeWrites = state.domWrites;
                const start = performance.now();
                try {
                    callback(timestamp);
                } finally {
                    const duration = performance.now() - start;
                    const callsDelta = subtractCalls(copyCalls(), beforeCalls);
                    const domCounterDelta = state.domWrites !== beforeWrites
                        || Object.values(callsDelta).some((count) => count !== 0);
                    const rootHost = nativeDocumentQuerySelector.call(document, '#sources-plus-root');
                    const shadowRoot = rootHost?.shadowRoot || null;
                    const managerActive = Boolean(shadowRoot
                        && nativeShadowRootQuerySelector.call(shadowRoot, '#sources-list.sp-drag-active'));
                    state.completedCallbackIds.push(callbackId);
                    if (managerActive) state.activeRafCallbacks += 1;
                    if (domCounterDelta) state.domDeltaRafCallbacks += 1;
                    const isExpected = state.expectedFrameCallbackIds.has(callbackId);
                    if (isExpected) state.expectedFrameCallbackIds.delete(callbackId);
                    if (state.captureManagerFrames && isExpected && managerActive && domCounterDelta) {
                        state.frameSamples.push({ callbackId, duration, callsDelta });
                    }
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
                state.geometryReads = { getBoundingClientRect: 0, offsetHeight: 0 };
                state.domWrites = 0;
                state.geometryReadPendingAfterWrite = false;
                state.forcedLayoutReadPhases = 0;
                state.frameSamples = [];
                state.expectedFrameCallbackIds.clear();
                state.captureManagerFrames = false;
                state.activeRafCallbacks = 0;
                state.domDeltaRafCallbacks = 0;
            } else if (command === 'reset-layout-phase') {
                state.geometryReadPendingAfterWrite = false;
                state.forcedLayoutReadPhases = 0;
            } else if (command === 'reset-frames') {
                state.frameSamples = [];
                state.expectedFrameCallbackIds.clear();
                state.captureManagerFrames = false;
            } else if (command === 'capture-frames') {
                state.captureManagerFrames = host.getAttribute('data-drag-benchmark-capture') === 'true';
            } else if (command === 'expect-frame') {
                const callbackId = Number(host.getAttribute('data-drag-benchmark-callback-id'));
                if (!Number.isSafeInteger(callbackId)
                    || !state.scheduledCallbackIds.includes(callbackId)
                    || state.completedCallbackIds.includes(callbackId)) {
                    throw new Error(`Invalid benchmark callback id ${callbackId}.`);
                }
                state.expectedFrameCallbackIds.add(callbackId);
            }
            nativeSetAttribute.call(host, 'data-drag-benchmark-result', JSON.stringify({
                calls: state.calls,
                geometryReads: state.geometryReads,
                domWrites: state.domWrites,
                geometryReadPendingAfterWrite: state.geometryReadPendingAfterWrite,
                forcedLayoutReadPhases: state.forcedLayoutReadPhases,
                frameSamples: state.frameSamples,
                scheduledCallbackIds: state.scheduledCallbackIds,
                completedCallbackIds: state.completedCallbackIds,
                expectedFrameCallbackIds: Array.from(state.expectedFrameCallbackIds),
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
            await installNotebookFixture(env.context, {
                resolveSources: ({ notebookId }) => {
                    const match = String(notebookId).match(/^drag-benchmark-(\d+)$/);
                    return match ? createSyntheticSources(Number(match[1])) : null;
                }
            });
            const extensionId = await waitForExtensionId(env.context, env.userDataDir, benchmarkExtensionRoot);
            await seedReflowPreference(env.context, extensionId);
            const allResults = [];
            for (const rowCount of rowCounts) {
                const page = await env.context.newPage();
                page.on('console', (message) => {
                    if (message.type() === 'info' && message.text().startsWith('DRAG_BENCHMARK_STAGE ')) {
                        console.log(message.text());
                    }
                });
                await page.goto(`https://notebooklm.google.com/notebook/drag-benchmark-${rowCount}`);
                await expect(page.locator('#sources-plus-root')).toBeVisible({ timeout: 20_000 });
                const trustedHandle = page.locator('#sources-list .source-item .sp-drag-handle').first();
                await expect(trustedHandle).toBeEnabled();
                await trustedHandle.scrollIntoViewIfNeeded();
                const handleBox = await trustedHandle.boundingBox();
                expect(handleBox).not.toBeNull();
                const handleX = handleBox.x + handleBox.width / 2;
                const handleY = handleBox.y + handleBox.height / 2;
                await page.mouse.move(handleX, handleY);
                await page.mouse.down();
                await page.mouse.move(handleX + 8, handleY + 8, { steps: 4 });
                await expect(page.locator('#sources-list.sp-drag-active')).toHaveCount(1);
                await page.keyboard.press('Escape');
                await page.mouse.up();
                await expect(page.locator('#sources-list.sp-drag-active')).toHaveCount(0);

                const results = await page.evaluate(async ({ nextRowCount, sources, warmupSessions, measuredSessions, warmupFrames, measuredFrames, dragEdgePx }) => {
                    const getRoot = () => document.querySelector('#sources-plus-root')?.shadowRoot || null;
                    const benchmarkBridge = (command, capture = null, callbackId = null) => {
                        const host = document.querySelector('#sources-plus-root');
                        if (!host) throw new Error('Benchmark host missing.');
                        host.setAttribute('data-drag-benchmark-command', command);
                        if (capture !== null) host.setAttribute('data-drag-benchmark-capture', capture ? 'true' : 'false');
                        if (callbackId !== null) host.setAttribute('data-drag-benchmark-callback-id', String(callbackId));
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
                    let sourceKeyPrefix = null;
                    let sourceWindowRowHeight = 44;
                    let sourceWindowOrdinalByKey = new Map();
                    const sourceKey = (number) => {
                        const normalizedNumber = String(number).padStart(4, '0');
                        const key = sourceKeyPrefix
                            ? `${sourceKeyPrefix}${normalizedNumber}`
                            : null;
                        if (!key) throw new Error(`Synthetic source key ${number} was not resolved.`);
                        return key;
                    };
                    const percentile = (values, fraction) => {
                        const sorted = values.slice().sort((left, right) => left - right);
                        const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1));
                        return Number(sorted[index].toFixed(3));
                    };
                    const subtractCalls = (after, before) => ({
                        getBoundingClientRect: after.getBoundingClientRect - before.getBoundingClientRect,
                        querySelector: after.querySelector - before.querySelector,
                        querySelectorAll: after.querySelectorAll - before.querySelectorAll
                    });
                    const addCalls = (totals, delta) => {
                        totals.getBoundingClientRect += delta.getBoundingClientRect;
                        totals.querySelector += delta.querySelector;
                        totals.querySelectorAll += delta.querySelectorAll;
                    };
                    const newCallbackIds = (before, after) => {
                        const previous = new Set(before);
                        return after.filter((callbackId) => !previous.has(callbackId));
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
                    const waitForCallbackIds = async (callbackIds, message) => {
                        if (callbackIds.length === 0) return;
                        const targetIds = new Set(callbackIds);
                        for (let frame = 0; frame < 60; frame += 1) {
                            const completed = new Set(benchmarkBridge('snapshot').completedCallbackIds);
                            if (Array.from(targetIds).every((callbackId) => completed.has(callbackId))) return;
                            await nextFrame();
                        }
                        const diagnostics = benchmarkBridge('snapshot');
                        throw new Error(`${message}; scheduled ${diagnostics.scheduledCallbackIds.join(',')}; completed ${diagnostics.completedCallbackIds.join(',')}.`);
                    };
                    const getSourcesList = () => getRoot()?.querySelector('#sources-list') || null;
                    const rowFor = (key) => getRoot()?.querySelector(`.source-item[data-source-key="${key}"]`) || null;
                    const getSourceWindowOrdinal = (row) => {
                        const ordinal = Number(row?.dataset?.sourceWindowOrdinal);
                        return Number.isSafeInteger(ordinal) && ordinal >= 0 ? ordinal : null;
                    };
                    const updateSourceWindowRowHeight = (list) => {
                        const spacer = Array.from(list?.querySelectorAll('.sp-source-window-spacer') || [])
                            .find((candidate) => Number(candidate.dataset?.sourceWindowRows) > 0);
                        const spacerRows = Number(spacer?.dataset?.sourceWindowRows);
                        const spacerHeight = Number.parseFloat(spacer?.style?.height || '');
                        if (Number.isFinite(spacerHeight) && spacerHeight > 0 && spacerRows > 0) {
                            sourceWindowRowHeight = spacerHeight / spacerRows;
                            return sourceWindowRowHeight;
                        }
                        const windowStart = Number(list?.dataset?.sourceWindowStart);
                        const scrollTop = Number(list?.scrollTop);
                        if (Number.isFinite(windowStart) && windowStart > 0 && Number.isFinite(scrollTop) && scrollTop > 0) {
                            sourceWindowRowHeight = scrollTop / windowStart;
                        }
                        return sourceWindowRowHeight;
                    };
                    const scrollSourceWindowTo = async (scrollTop) => {
                        const list = getSourcesList();
                        if (!list) throw new Error('Benchmark sources list missing.');
                        list.scrollTop = Math.max(0, Number(scrollTop) || 0);
                        list.dispatchEvent(new Event('scroll', { bubbles: true }));
                        await nextFrame();
                        await nextFrame();
                        updateSourceWindowRowHeight(list);
                        return list;
                    };
                    const materializeSource = async (key, { forceScroll = false } = {}) => {
                        const existing = rowFor(key);
                        const shouldForceScroll = forceScroll
                            && getSourcesList()?.dataset?.sourceWindowingActive === 'true';
                        if (existing && !shouldForceScroll) return existing;
                        const ordinal = sourceWindowOrdinalByKey.get(key);
                        if (!Number.isSafeInteger(ordinal) || ordinal < 0) {
                            throw new Error(`No logical source-window ordinal is available for ${key}.`);
                        }
                        await scrollSourceWindowTo(ordinal * sourceWindowRowHeight);
                        return waitFor(() => rowFor(key), `Benchmark source ${key} did not materialize.`);
                    };
                    const prepareWindowedSourceOrdinals = async () => {
                        const list = getSourcesList();
                        if (!list || list.dataset?.sourceWindowingActive !== 'true') return;

                        await scrollSourceWindowTo(0);
                        const rootAnchor = await waitFor(
                            () => rowFor(sourceKey(21)),
                            'Root source anchor did not materialize in the initial source window.'
                        );
                        const rootStart = getSourceWindowOrdinal(rootAnchor);
                        if (rootStart === null) {
                            throw new Error('Root source anchor is missing its logical source-window ordinal.');
                        }

                        let groupedStart = getSourceWindowOrdinal(rowFor(sourceKey(1)));
                        if (groupedStart === null) {
                            await scrollSourceWindowTo(list.scrollHeight);
                            const groupedAnchor = await waitFor(
                                () => rowFor(sourceKey(1)),
                                'Grouped source anchor did not materialize at the end of the source window.'
                            );
                            groupedStart = getSourceWindowOrdinal(groupedAnchor);
                        }
                        if (groupedStart === null) {
                            throw new Error('Grouped source anchor is missing its logical source-window ordinal.');
                        }

                        const nextOrdinals = new Map();
                        for (let number = 1; number <= nextRowCount; number += 1) {
                            const ordinal = number <= 20
                                ? groupedStart + number - 1
                                : rootStart + number - 21;
                            nextOrdinals.set(sourceKey(number), ordinal);
                        }
                        const uniqueOrdinals = new Set(nextOrdinals.values());
                        if (nextOrdinals.size !== nextRowCount || uniqueOrdinals.size !== nextRowCount
                            || Math.min(...uniqueOrdinals) !== 0 || Math.max(...uniqueOrdinals) !== nextRowCount - 1) {
                            throw new Error('Synthetic source placement did not retain a complete logical window projection.');
                        }
                        sourceWindowOrdinalByKey = nextOrdinals;
                    };
                    let nextDragSessionId = 0;
                    const dragBridge = (command, args = {}) => {
                        const host = document.querySelector('#sources-plus-root');
                        if (!host) throw new Error('Benchmark pointer bridge host is unavailable.');
                        host.setAttribute('data-drag-benchmark-pointer-args', JSON.stringify({ command, ...args }));
                        host.dispatchEvent(new Event('sources-plus-drag-benchmark-pointer-command', {
                            bubbles: true,
                            composed: true
                        }));
                        const raw = host.getAttribute('data-drag-benchmark-pointer-result');
                        if (!raw) throw new Error(`Benchmark pointer ${command} did not return a result.`);
                        const response = JSON.parse(raw);
                        if (response.error) throw new Error(response.error);
                        return response.result;
                    };
                    const preparePointer = (row) => {
                        const handle = row?.querySelector('.sp-drag-handle');
                        if (!handle?.isConnected || handle.disabled
                            || handle.closest('.source-item') !== row) {
                            throw new Error('Benchmark origin is missing a live enabled source handle.');
                        }
                        const rect = handle.getBoundingClientRect();
                        if (dragBridge('prepare', { sourceKey: row.dataset.sourceKey }) !== true) {
                            throw new Error('Benchmark pointer origin could not be prepared.');
                        }
                        return {
                            sourceKey: row.dataset.sourceKey,
                            clientX: rect.left + rect.width / 2,
                            clientY: rect.top + rect.height / 2,
                            sessionId: ++nextDragSessionId
                        };
                    };
                    const startDrag = (pointer) => {
                        if (dragBridge('start', pointer) !== true) {
                            throw new Error('Benchmark shared pointer drag did not start.');
                        }
                        return pointer;
                    };
                    const updateDrag = (pointer, point) => {
                        dragBridge('update', { ...pointer, ...point });
                    };
                    const cancelDrag = (label) => {
                        if (!getSourcesList()?.isConnected) {
                            throw new Error(`Benchmark ${label} pointer drag target is disconnected.`);
                        }
                        dragBridge('cancel', { reason: label });
                    };
                    const normalizePrepareState = () => {
                        const sourcesList = getRoot()?.querySelector('#sources-list');
                        if (!sourcesList) throw new Error('Benchmark sources list missing.');

                        // Direct test-surface calls skip the pointerdown event's
                        // incidental hover cleanup. Reproduce that settled state
                        // outside the timed interval.
                        sourcesList.classList.remove('sp-drag-active');
                        sourcesList.querySelectorAll('.sp-pseudo-hover').forEach((node) => {
                            node.classList.remove('sp-pseudo-hover');
                        });

                        const settledHeight = sourcesList.offsetHeight;
                        if (!Number.isFinite(settledHeight)) {
                            throw new Error('Benchmark sources list did not settle layout.');
                        }

                        const resetSnapshot = benchmarkBridge('reset');
                        if (resetSnapshot.forcedLayoutReadPhases !== 0
                            || resetSnapshot.geometryReadPendingAfterWrite
                            || resetSnapshot.domWrites !== 0
                            || Object.values(resetSnapshot.calls).some((count) => count !== 0)
                            || Object.values(resetSnapshot.geometryReads).some((count) => count !== 0)) {
                            throw new Error('Prepare-state normalization did not reset instrumentation.');
                        }
                        return resetSnapshot;
                    };
                    const enableBatch = async () => {
                        const root = getRoot();
                        if (root?.querySelector('.sp-batch-checkbox')) return;
                        root.querySelector('#sp-batch-action-btn')?.click();
                        await waitFor(() => getRoot()?.querySelectorAll('.sp-batch-checkbox').length > 0, 'Batch mode did not enable.');
                    };
                    const selectKeys = async (keys) => {
                        for (let index = 0; index < keys.length; index += 1) {
                            const key = keys[index];
                            const row = await materializeSource(key);
                            const checkbox = row?.querySelector('.sp-batch-checkbox');
                            if (!checkbox) throw new Error(`Batch checkbox missing for ${key}.`);
                            checkbox.click();
                            await waitFor(() => Number(getSourcesList()?.dataset?.pendingSelected) === index + 1,
                                `Batch selection did not retain ${index + 1} logical source(s).`);
                        }
                        await nextFrame();
                        const list = getSourcesList();
                        const visibleSelected = Number(list?.dataset?.visibleSelected) || 0;
                        const hiddenSelected = Number(list?.dataset?.hiddenSelected) || 0;
                        if (visibleSelected + hiddenSelected !== keys.length) {
                            throw new Error(`Expected ${keys.length} logical selected keys, saw ${visibleSelected} visible + ${hiddenSelected} hidden.`);
                        }
                    };
                    const createGroups = async () => {
                        for (let index = 1; index <= 2; index += 1) {
                            const button = getRoot()?.querySelector('#sp-new-group-btn');
                            if (!button) throw new Error('New group button missing.');
                            button.click();
                            let groupNameInput = null;
                            await waitFor(() => {
                                groupNameInput = getRoot()?.querySelector('.sp-inline-group-name-input') || null;
                                return Boolean(groupNameInput);
                            }, `Benchmark group ${index} name input did not render.`);
                            const groupId = groupNameInput.closest('.group-container')?.dataset.groupId;
                            if (!groupId) {
                                throw new Error(`Benchmark group ${index} is missing data-group-id.`);
                            }
                            const groupName = `Benchmark group ${index}`;
                            groupNameInput.value = groupName;
                            groupNameInput.dispatchEvent(new Event('input', { bubbles: true }));
                            groupNameInput.dispatchEvent(new KeyboardEvent('keydown', {
                                key: 'Enter',
                                bubbles: true,
                                cancelable: true
                            }));
                            await waitFor(() => {
                                const title = getRoot()?.querySelector(
                                    `.group-container[data-group-id="${groupId}"] .group-title`
                                );
                                return title?.textContent?.trim() === groupName;
                            }, `${groupName} did not persist after inline naming.`);
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
                        const origin = await materializeSource(keys[0]);
                        const target = getRoot()?.querySelector(`.group-container[data-group-id="${groupId}"]`);
                        if (!origin || !target) throw new Error('Benchmark distribution target missing.');
                        const pointer = startDrag(preparePointer(origin));
                        await nextFrame();
                        const rect = target.querySelector('.group-header')?.getBoundingClientRect();
                        if (!rect) throw new Error('Benchmark destination header missing.');
                        const dropPoint = {
                            clientX: Math.floor(rect.left + rect.width * 0.75),
                            clientY: Math.floor(rect.top + rect.height / 2)
                        };
                        updateDrag(pointer, dropPoint);
                        await nextFrame();
                        if (dragBridge('commit', { ...pointer, ...dropPoint }) !== true) {
                            throw new Error('Benchmark selection distribution did not commit.');
                        }
                        await wait(30);
                        await nextFrame();
                        await waitFor(() => getRoot()?.querySelectorAll('.sp-batch-checkbox').length === 0,
                            'Batch mode did not exit after pointer drop.');
                    };
                    const runPrepare = async (originKey, selectionCount, record) => {
                        const origin = await materializeSource(originKey, { forceScroll: true });
                        if (!origin) throw new Error(`Benchmark origin ${originKey} missing.`);
                        const materializedSelectionCount = selectionCount > 1
                            ? getRoot()?.querySelectorAll('.source-item.selected-for-batch').length || 0
                            : 1;
                        if (materializedSelectionCount < 1 || materializedSelectionCount > selectionCount) {
                            throw new Error(`Invalid materialized selection count ${materializedSelectionCount}/${selectionCount}.`);
                        }
                        if (selectionCount > 1
                            && Number(getSourcesList()?.dataset?.pendingSelected) !== selectionCount) {
                            throw new Error(`Drag prepare lost part of the ${selectionCount}-source logical selection.`);
                        }
                        const pointer = preparePointer(origin);
                        const before = normalizePrepareState();
                        const start = performance.now();
                        startDrag(pointer);
                        const cpuMs = performance.now() - start;
                        const syncSnapshot = benchmarkBridge('snapshot');
                        const callsDelta = subtractCalls(syncSnapshot.calls, before.calls);
                        const geometryReadsDelta = {
                            getBoundingClientRect: syncSnapshot.geometryReads.getBoundingClientRect
                                - before.geometryReads.getBoundingClientRect,
                            offsetHeight: syncSnapshot.geometryReads.offsetHeight
                                - before.geometryReads.offsetHeight
                        };
                        const foldCallbackIds = newCallbackIds(
                            before.scheduledCallbackIds,
                            syncSnapshot.scheduledCallbackIds
                        );
                        if (syncSnapshot.forcedLayoutReadPhases < 1) {
                            throw new Error('Synchronous pointer start did not record a write-before-geometry-read phase.');
                        }
                        if (geometryReadsDelta.offsetHeight < materializedSelectionCount) {
                            throw new Error(`Synchronous pointer start recorded ${geometryReadsDelta.offsetHeight} offsetHeight reads for ${materializedSelectionCount}/${selectionCount} materialized/logical selected item(s).`);
                        }
                        if (foldCallbackIds.length === 0) {
                            throw new Error('Synchronous pointer start did not schedule its deferred fold callback.');
                        }
                        if (record) {
                            record.cpu.push(cpuMs);
                            record.forced.push(syncSnapshot.forcedLayoutReadPhases);
                            record.materializedSelectionCounts.push(materializedSelectionCount);
                            addCalls(record.calls, callsDelta);
                        }
                        await waitForCallbackIds(foldCallbackIds, 'Deferred pointer-start fold did not complete');
                        if (selectionCount > 1
                            && Number(getSourcesList()?.dataset?.pendingSelected) !== selectionCount) {
                            throw new Error(`Pointer drag did not retain ${selectionCount} logical selected sources.`);
                        }
                        const beforeDragEnd = benchmarkBridge('snapshot');
                        cancelDrag('prepare');
                        const afterDragEnd = benchmarkBridge('snapshot');
                        await waitForCallbackIds(
                            newCallbackIds(beforeDragEnd.scheduledCallbackIds, afterDragEnd.scheduledCallbackIds),
                            'Dragend cleanup callback did not complete'
                        );
                        await wait(5);
                    };
                    const prepareCallbackTargets = async (originKey, selectionCount) => {
                        const targetNumbers = getSourcesList()?.dataset?.sourceWindowingActive === 'true'
                            ? (
                                selectionCount > 1
                                    ? [56, 57]
                                    : [nextRowCount - 20, nextRowCount - 19]
                            )
                            : [];
                        const targetKeys = targetNumbers.map((number) => sourceKey(number));
                        for (const targetKey of targetKeys) {
                            await materializeSource(targetKey);
                        }
                        const origin = await materializeSource(originKey, { forceScroll: true });
                        return {
                            origin,
                            targetKeys
                        };
                    };
                    const runCallbackFrames = async (originKey, selectionCount, frameCount) => {
                        const { origin, targetKeys } = await prepareCallbackTargets(originKey, selectionCount);
                        if (!origin) throw new Error(`Frame benchmark origin ${originKey} missing.`);
                        const pointer = preparePointer(origin);
                        const beforeDragStart = benchmarkBridge('snapshot');
                        startDrag(pointer);
                        const afterDragStart = benchmarkBridge('snapshot');
                        const foldCallbackIds = newCallbackIds(
                            beforeDragStart.scheduledCallbackIds,
                            afterDragStart.scheduledCallbackIds
                        );
                        if (foldCallbackIds.length === 0) {
                            throw new Error('Frame benchmark pointer start did not synchronously schedule a fold callback.');
                        }
                        await waitForCallbackIds(foldCallbackIds, 'Frame benchmark fold callback did not complete');
                        benchmarkBridge('reset-frames');
                        const root = getRoot();
                        const initialListRect = getSourcesList()?.getBoundingClientRect();
                        const inputPoints = Array.from(new Set([
                            ...Array.from(root?.querySelectorAll('.source-item:not(.selected-for-batch)') || [])
                        ])).flatMap((candidate) => {
                            if (!candidate.isConnected || !root.contains(candidate)
                                || candidate.classList.contains('selected-for-batch')) return [];
                            const rect = candidate.getBoundingClientRect();
                            const point = {
                                sourceKey: candidate.dataset.sourceKey,
                                clientX: Math.floor(rect.left + rect.width / 2),
                                clientY: Math.floor(rect.top + rect.height / 2)
                            };
                            return rect.height > 1 && initialListRect
                                && point.clientY >= initialListRect.top + dragEdgePx
                                && point.clientY <= initialListRect.bottom - dragEdgePx
                                ? [point] : [];
                        }).slice(0, 12);
                        if (inputPoints.length < 2) {
                            const list = getSourcesList();
                            const rows = Array.from(root?.querySelectorAll('.source-item') || []).map((row) => {
                                const rect = row.getBoundingClientRect();
                                return { key: row.dataset.sourceKey, selected: row.classList.contains('selected-for-batch'), folded: row.classList.contains('sp-drag-folded'), top: rect.top, height: rect.height };
                            });
                            throw new Error(`Only ${inputPoints.length} connected non-edge benchmark input points: ${JSON.stringify({ rowCount: nextRowCount, selectionCount, frameCount, scrollTop: list?.scrollTop, windowStart: list?.dataset.sourceWindowStart, windowEnd: list?.dataset.sourceWindowEnd, listRect: initialListRect, rows })}.`);
                        }
                        benchmarkBridge('capture-frames', true);
                        const targetCallbackIds = [];
                        for (let index = 0; index < frameCount; index += 1) {
                            // Keep input fixed instead of chasing the animated output
                            // rows. A pointer over an opened slot targets the current
                            // list, even when the original row has moved or unmounted.
                            const point = inputPoints[(index * 17 + 7) % inputPoints.length];
                            const target = getSourcesList();
                            const listRect = target?.getBoundingClientRect();
                            if (!target?.isConnected || !listRect
                                || point.clientY < listRect.top + dragEdgePx
                                || point.clientY > listRect.bottom - dragEdgePx) {
                                throw new Error('Benchmark input left the connected list non-edge region.');
                            }
                            const beforeDragOver = benchmarkBridge('snapshot');
                            updateDrag(pointer, {
                                clientX: point.clientX,
                                clientY: point.clientY
                            });
                            const afterDragOver = benchmarkBridge('snapshot');
                            const scheduledForDragOver = newCallbackIds(
                                beforeDragOver.scheduledCallbackIds,
                                afterDragOver.scheduledCallbackIds
                            );
                            if (scheduledForDragOver.length !== 1) {
                                throw new Error(`Dragover ${index + 1}/${frameCount} scheduled ${scheduledForDragOver.length} callbacks instead of exactly one; input ${point.sourceKey}, connected=${target.isConnected}, window=${target.dataset?.sourceWindowStart}:${target.dataset?.sourceWindowEnd}.`);
                            }
                            const callbackId = scheduledForDragOver[0];
                            targetCallbackIds.push(callbackId);
                            benchmarkBridge('expect-frame', null, callbackId);
                            await waitForCallbackIds([callbackId], `Target pointer-update callback ${callbackId} did not complete`);
                            const qualifying = benchmarkBridge('snapshot').frameSamples
                                .filter((sample) => sample.callbackId === callbackId);
                            if (qualifying.length !== 1) {
                                throw new Error(`Target pointer-update callback ${callbackId} produced ${qualifying.length} qualifying samples instead of exactly one.`);
                            }
                        }
                        const finalSnapshot = benchmarkBridge('capture-frames', false);
                        const frames = finalSnapshot.frameSamples;
                        const sampleIds = frames.map((sample) => sample.callbackId);
                        const uniqueTargetIds = new Set(targetCallbackIds);
                        const uniqueSampleIds = new Set(sampleIds);
                        if (frames.length !== frameCount
                            || uniqueTargetIds.size !== frameCount
                            || uniqueSampleIds.size !== frameCount
                            || targetCallbackIds.some((callbackId, index) => sampleIds[index] !== callbackId)
                            || finalSnapshot.expectedFrameCallbackIds.length !== 0) {
                            throw new Error(`Expected exact callback IDs ${targetCallbackIds.join(',')}; sampled ${sampleIds.join(',')}; pending ${finalSnapshot.expectedFrameCallbackIds.join(',')}.`);
                        }
                        frames.forEach((sample) => {
                            if (!Number.isSafeInteger(sample.callbackId)
                                || typeof sample.duration !== 'number'
                                || !sample.callsDelta
                                || Object.values(sample.callsDelta).some((count) => !Number.isInteger(count) || count < 0)) {
                                throw new Error(`Invalid exact callback sample ${JSON.stringify(sample)}.`);
                            }
                        });
                        const beforeDragEnd = benchmarkBridge('snapshot');
                        cancelDrag('callback');
                        const afterDragEnd = benchmarkBridge('snapshot');
                        await waitForCallbackIds(
                            newCallbackIds(beforeDragEnd.scheduledCallbackIds, afterDragEnd.scheduledCallbackIds),
                            'Frame benchmark pointer-cancel cleanup callback did not complete'
                        );
                        return { frames, targetCallbackIds, inputPoints };
                    };
                    const benchmarkSelection = async ({ selectionCount, originKey, selectedKeys }) => {
                        const reportStage = (stage) => console.info(
                            `DRAG_BENCHMARK_STAGE ${nextRowCount}:${selectionCount}:${stage}`
                        );
                        if (selectionCount === 50) {
                            reportStage('select');
                            await enableBatch();
                            await selectKeys(selectedKeys);
                        }
                        const prepare = {
                            cpu: [],
                            forced: [],
                            materializedSelectionCounts: [],
                            calls: { getBoundingClientRect: 0, querySelector: 0, querySelectorAll: 0 }
                        };
                        reportStage('prepare-warmup');
                        for (let index = 0; index < warmupSessions; index += 1) {
                            await runPrepare(originKey, selectionCount, null);
                        }
                        benchmarkBridge('reset');
                        reportStage('prepare-measured');
                        for (let index = 0; index < measuredSessions; index += 1) {
                            await runPrepare(originKey, selectionCount, prepare);
                        }
                        // Earlier pointer cancellations schedule the production pseudo-hover
                        // backstop for 1500ms. Let those old sessions finish before timing one
                        // continuous active-drag sequence, otherwise an old cleanup can remove
                        // the current list's manager-active marker mid-sample.
                        await wait(1600);
                        reportStage('frame-warmup');
                        const warmup = await runCallbackFrames(originKey, selectionCount, warmupFrames);
                        if (warmup.frames.length !== warmupFrames
                            || warmup.targetCallbackIds.length !== warmupFrames) {
                            throw new Error('Exact manager-active drag callback warmup was not captured.');
                        }
                        await wait(1600);
                        benchmarkBridge('reset');
                        reportStage('frame-measured');
                        const measured = await runCallbackFrames(originKey, selectionCount, measuredFrames);
                        const callbackCalls = { getBoundingClientRect: 0, querySelector: 0, querySelectorAll: 0 };
                        measured.frames.forEach((sample) => addCalls(callbackCalls, sample.callsDelta));
                        const callbackDurations = measured.frames.map((sample) => sample.duration);
                        return {
                            rowCount: nextRowCount,
                            selectionCount,
                            warmupSessions,
                            measuredSessions,
                            warmupFrames,
                            measuredFrames,
                            logicalSelectionCount: selectionCount,
                            callbackInputPoints: measured.inputPoints,
                            materializedSelectionCount: {
                                p50: percentile(prepare.materializedSelectionCounts, 0.5),
                                p95: percentile(prepare.materializedSelectionCounts, 0.95)
                            },
                            prepareCpuMs: {
                                p50: percentile(prepare.cpu, 0.5),
                                p95: percentile(prepare.cpu, 0.95)
                            },
                            prepareForcedLayoutReadPhases: { max: Math.max(...prepare.forced) },
                            callbackCpuMs: {
                                p50: percentile(callbackDurations, 0.5),
                                p95: percentile(callbackDurations, 0.95)
                            },
                            calls: {
                                getBoundingClientRect: prepare.calls.getBoundingClientRect + callbackCalls.getBoundingClientRect,
                                querySelector: prepare.calls.querySelector + callbackCalls.querySelector,
                                querySelectorAll: prepare.calls.querySelectorAll + callbackCalls.querySelectorAll
                            }
                        };
                    };

                    window.__swapNotebook({
                        notebookId: `drag-benchmark-${nextRowCount}`,
                        sources
                    });
                    await waitFor(() => {
                        const list = getRoot()?.querySelector('#sources-list');
                        const materializedCount = list?.querySelectorAll('.source-item').length || 0;
                        const logicalCount = Number(list?.dataset?.logicalSourceCount);
                        const windowingActive = list?.dataset?.sourceWindowingActive === 'true';
                        if (logicalCount !== nextRowCount || materializedCount === 0) return false;
                        return nextRowCount < 240
                            ? materializedCount === nextRowCount
                            : windowingActive && materializedCount < nextRowCount;
                    }, `Manager did not expose ${nextRowCount} synthetic sources through its logical window.`);
                    const firstRow = getRoot()?.querySelector(
                        '.source-item[data-source-window-ordinal="0"]'
                    ) || getRoot()?.querySelector('.source-item');
                    const firstTitle = firstRow?.querySelector('.source-title-text')?.textContent || '';
                    const firstKey = firstRow?.dataset?.sourceKey || '';
                    if (firstTitle !== 'Synthetic source 0001' || !firstKey.endsWith('0001')) {
                        throw new Error('Could not derive the deterministic synthetic source-key prefix.');
                    }
                    sourceKeyPrefix = firstKey.slice(0, -4);
                    const groupIds = await createGroups();
                    console.info(`DRAG_BENCHMARK_STAGE ${nextRowCount}:distribute`);
                    for (let index = 0; index < 2; index += 1) {
                        const first = index * 10 + 1;
                        await moveSelectionIntoGroup(Array.from({ length: 10 }, (_, offset) => sourceKey(first + offset)), groupIds[index]);
                    }
                    const distributed = groupIds.flatMap((groupId) => Array.from(
                        getRoot()?.querySelectorAll(`.group-container[data-group-id="${groupId}"] .source-item`) || []
                    ).map((row) => row.dataset.sourceKey).filter(Boolean));
                    if (distributed.length !== 20) throw new Error(`Expected 20 grouped benchmark sources, saw ${distributed.length}.`);
                    await prepareWindowedSourceOrdinals();
                    const postDistributionList = getSourcesList();
                    if (Number(postDistributionList?.dataset?.logicalSourceCount) !== nextRowCount) {
                        throw new Error('Benchmark grouping changed the complete logical source projection.');
                    }
                    if (nextRowCount >= 240 && (
                        postDistributionList?.dataset?.sourceWindowingActive !== 'true'
                        || Number(postDistributionList?.dataset?.materializedSourceCount) >= nextRowCount
                    )) {
                        throw new Error('Benchmark grouping disabled or bypassed source windowing.');
                    }

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
                    dragEdgePx: autoScrollEdgePx,
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
