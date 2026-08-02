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
                await page.goto(`https://notebooklm.google.com/notebook/drag-benchmark-${rowCount}`);
                await expect(page.locator('#sources-plus-root')).toBeVisible({ timeout: 20_000 });

                const results = await page.evaluate(async ({ nextRowCount, sources, warmupSessions, measuredSessions, warmupFrames, measuredFrames }) => {
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
                    const normalizePrepareState = () => {
                        const sourcesList = getRoot()?.querySelector('#sources-list');
                        if (!sourcesList) throw new Error('Benchmark sources list missing.');

                        // A real next drag starts after a trusted pointerdown, which
                        // clears dragend's pseudo-hover bridge before dragstart. The
                        // benchmark dispatches synthetic drag events directly, so
                        // reproduce that pre-drag state outside the timed interval.
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
                    const runPrepare = async (originKey, selectionCount, record) => {
                        const origin = rowFor(originKey);
                        if (!origin) throw new Error(`Benchmark origin ${originKey} missing.`);
                        const before = normalizePrepareState();
                        const start = performance.now();
                        const dataTransfer = dispatchDrag(origin, 'dragstart');
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
                            throw new Error('Synchronous dragstart did not record a write-before-geometry-read phase.');
                        }
                        if (geometryReadsDelta.offsetHeight < selectionCount) {
                            throw new Error(`Synchronous dragstart recorded ${geometryReadsDelta.offsetHeight} offsetHeight reads for ${selectionCount} selected item(s).`);
                        }
                        if (foldCallbackIds.length === 0) {
                            throw new Error('Synchronous dragstart did not schedule its deferred fold callback.');
                        }
                        if (record) {
                            record.cpu.push(cpuMs);
                            record.forced.push(syncSnapshot.forcedLayoutReadPhases);
                            addCalls(record.calls, callsDelta);
                        }
                        await waitForCallbackIds(foldCallbackIds, 'Deferred dragstart fold did not complete');
                        const beforeDragEnd = benchmarkBridge('snapshot');
                        dispatchDrag(origin, 'dragend', { dataTransfer });
                        const afterDragEnd = benchmarkBridge('snapshot');
                        await waitForCallbackIds(
                            newCallbackIds(beforeDragEnd.scheduledCallbackIds, afterDragEnd.scheduledCallbackIds),
                            'Dragend cleanup callback did not complete'
                        );
                        await wait(5);
                    };
                    const runCallbackFrames = async (originKey, frameCount) => {
                        const origin = rowFor(originKey);
                        if (!origin) throw new Error(`Frame benchmark origin ${originKey} missing.`);
                        const beforeDragStart = benchmarkBridge('snapshot');
                        const dataTransfer = dispatchDrag(origin, 'dragstart');
                        const afterDragStart = benchmarkBridge('snapshot');
                        const foldCallbackIds = newCallbackIds(
                            beforeDragStart.scheduledCallbackIds,
                            afterDragStart.scheduledCallbackIds
                        );
                        if (foldCallbackIds.length === 0) {
                            throw new Error('Frame benchmark dragstart did not synchronously schedule a fold callback.');
                        }
                        await waitForCallbackIds(foldCallbackIds, 'Frame benchmark fold callback did not complete');
                        benchmarkBridge('reset-frames');
                        const listRect = getRoot()?.querySelector('#sources-list')?.getBoundingClientRect();
                        const candidates = Array.from(getRoot()?.querySelectorAll('.source-item:not(.selected-for-batch)') || [])
                            .filter((candidate) => {
                                const rect = candidate.getBoundingClientRect();
                                return listRect && rect.bottom > listRect.top && rect.top < listRect.bottom;
                            })
                            .slice(0, 12);
                        if (candidates.length < 2) throw new Error('Not enough non-selected benchmark drag targets.');
                        benchmarkBridge('capture-frames', true);
                        const targetCallbackIds = [];
                        for (let index = 0; index < frameCount; index += 1) {
                            const target = candidates[(index * 17 + 7) % candidates.length];
                            const rect = target.getBoundingClientRect();
                            const beforeDragOver = benchmarkBridge('snapshot');
                            dispatchDrag(target, 'dragover', {
                                dataTransfer,
                                clientX: Math.floor(rect.left + rect.width / 2),
                                clientY: Math.floor(rect.top + rect.height / 2)
                            });
                            const afterDragOver = benchmarkBridge('snapshot');
                            const scheduledForDragOver = newCallbackIds(
                                beforeDragOver.scheduledCallbackIds,
                                afterDragOver.scheduledCallbackIds
                            );
                            if (scheduledForDragOver.length !== 1) {
                                throw new Error(`Dragover ${index + 1}/${frameCount} scheduled ${scheduledForDragOver.length} callbacks instead of exactly one.`);
                            }
                            const callbackId = scheduledForDragOver[0];
                            targetCallbackIds.push(callbackId);
                            benchmarkBridge('expect-frame', null, callbackId);
                            await waitForCallbackIds([callbackId], `Target dragover callback ${callbackId} did not complete`);
                            const qualifying = benchmarkBridge('snapshot').frameSamples
                                .filter((sample) => sample.callbackId === callbackId);
                            if (qualifying.length !== 1) {
                                throw new Error(`Target dragover callback ${callbackId} produced ${qualifying.length} qualifying samples instead of exactly one.`);
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
                        dispatchDrag(origin, 'dragend', { dataTransfer });
                        const afterDragEnd = benchmarkBridge('snapshot');
                        await waitForCallbackIds(
                            newCallbackIds(beforeDragEnd.scheduledCallbackIds, afterDragEnd.scheduledCallbackIds),
                            'Frame benchmark dragend cleanup callback did not complete'
                        );
                        return { frames, targetCallbackIds };
                    };
                    const benchmarkSelection = async ({ selectionCount, originKey, selectedKeys }) => {
                        if (selectionCount === 50) {
                            await enableBatch();
                            await selectKeys(selectedKeys);
                        }
                        const prepare = {
                            cpu: [],
                            forced: [],
                            calls: { getBoundingClientRect: 0, querySelector: 0, querySelectorAll: 0 }
                        };
                        for (let index = 0; index < warmupSessions; index += 1) {
                            await runPrepare(originKey, selectionCount, null);
                        }
                        benchmarkBridge('reset');
                        for (let index = 0; index < measuredSessions; index += 1) {
                            await runPrepare(originKey, selectionCount, prepare);
                        }
                        // Earlier synthetic dragend calls schedule the production pseudo-hover
                        // backstop for 1500ms. Let those old sessions finish before timing one
                        // continuous active-drag sequence, otherwise an old cleanup can remove
                        // the current list's manager-active marker mid-sample.
                        await wait(1600);
                        const warmup = await runCallbackFrames(originKey, warmupFrames);
                        if (warmup.frames.length !== warmupFrames
                            || warmup.targetCallbackIds.length !== warmupFrames) {
                            throw new Error('Exact manager-active drag callback warmup was not captured.');
                        }
                        await wait(1600);
                        benchmarkBridge('reset');
                        const measured = await runCallbackFrames(originKey, measuredFrames);
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
                    await waitFor(
                        () => getRoot()?.querySelectorAll('#sources-list .source-item').length === nextRowCount,
                        `Manager did not render ${nextRowCount} synthetic sources.`
                    );
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
