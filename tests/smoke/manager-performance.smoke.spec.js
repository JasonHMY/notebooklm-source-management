const os = require('os');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const { test, expect } = require('@playwright/test');

const {
    closeExtensionContext,
    launchExtensionContext,
    openExtensionPage,
    waitForExtensionId
} = require('./helpers/extension-context');
const { installNotebookFixture } = require('./helpers/notebooklm-fixture');

const repoRoot = path.resolve(__dirname, '../..');
const readBoundedRunCount = (name, fallback, maximum) => {
    const value = Number(process.env[name]);
    return Number.isInteger(value) && value >= 1 && value <= maximum
        ? value
        : fallback;
};
const WARMUP_RUNS = readBoundedRunCount('MANAGER_BENCHMARK_WARMUP_RUNS', 5, 20);
const MEASURED_RUNS = readBoundedRunCount('MANAGER_BENCHMARK_MEASURED_RUNS', 20, 100);
const EXPECTED_INSTRUMENTED_API_COUNT = 15;
const DEFAULT_ROW_COUNTS = [100, 500, 1000, 5000];
const requestedRowCounts = String(process.env.MANAGER_BENCHMARK_ROWS || '')
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => DEFAULT_ROW_COUNTS.includes(value));
const ROW_COUNTS = requestedRowCounts.length > 0
    ? Array.from(new Set(requestedRowCounts))
    : DEFAULT_ROW_COUNTS;

test.skip(
    process.env.MANAGER_BENCHMARK !== '1',
    'Set MANAGER_BENCHMARK=1 to run the opt-in manager benchmark.'
);

function createSyntheticSources(rowCount) {
    return Array.from({ length: rowCount }, (_, index) => {
        const number = String(index + 1).padStart(5, '0');
        return {
            id: `manager-benchmark-source-${number}`,
            token: `manager-benchmark-source-${number}`,
            title: `Manager benchmark source ${number}`
        };
    });
}

async function seedBenchmarkPreferences(context, extensionId) {
    const bridgePage = await openExtensionPage(context, extensionId, 'src/popup/popup.html');
    try {
        const response = await bridgePage.evaluate(async () => chrome.runtime.sendMessage({
            type: 'SAVE_PREFERENCES',
            preferences: {
                welcomeOnboardingSeenVersion: 1
            }
        }));
        if (!response?.success) {
            throw new Error(`Could not seed manager benchmark preferences: ${response?.errorCode || 'unknown_error'}.`);
        }
    } finally {
        await bridgePage.close();
    }
}

function resolveCommitSha() {
    try {
        return execFileSync('git', ['rev-parse', 'HEAD'], {
            cwd: repoRoot,
            encoding: 'utf8'
        }).trim();
    } catch (error) {
        return 'unknown';
    }
}

function createContentInstrumentationScript() {
    function instrumentContentWorld() {
        if (globalThis.__NSM_MANAGER_BENCHMARK_INSTRUMENTATION__) return;

        const createCounters = () => ({
            queries: {
                querySelector: 0,
                querySelectorAll: 0
            },
            layoutReads: {
                getBoundingClientRect: 0,
                getClientRects: 0,
                getComputedStyle: 0,
                offsetHeight: 0,
                offsetWidth: 0,
                clientHeight: 0,
                clientWidth: 0,
                scrollHeight: 0,
                scrollWidth: 0
            }
        });
        const sumCounts = (counts) => Object.values(counts).reduce(
            (total, value) => total + value,
            0
        );
        const state = {
            active: false,
            counters: createCounters(),
            installFailures: [],
            patches: [],
            patchedKeys: new Set(),
            restoreFailures: []
        };

        const findPropertyOwner = (start, property) => {
            let current = start;
            while (current) {
                const descriptor = Object.getOwnPropertyDescriptor(current, property);
                if (descriptor) return { descriptor, target: current };
                current = Object.getPrototypeOf(current);
            }
            return null;
        };
        const recordInstallFailure = (label, reason) => {
            state.installFailures.push({ label, reason });
        };
        const patchKey = (target, property) => `${property}:${String(target)}`;
        const patchMethod = (label, start, property, counterGroup, counterKey) => {
            const located = findPropertyOwner(start, property);
            if (!located || typeof located.descriptor.value !== 'function'
                || !located.descriptor.configurable) {
                recordInstallFailure(label, 'unavailable');
                return;
            }

            const key = patchKey(located.target, property);
            if (state.patchedKeys.has(key)) return;
            const original = located.descriptor.value;
            const wrapped = function managerBenchmarkInstrumentedMethod(...args) {
                if (state.active) state.counters[counterGroup][counterKey] += 1;
                return original.apply(this, args);
            };
            try {
                Object.defineProperty(located.target, property, {
                    ...located.descriptor,
                    value: wrapped
                });
                state.patches.push({
                    descriptor: located.descriptor,
                    label,
                    property,
                    target: located.target
                });
                state.patchedKeys.add(key);
            } catch (error) {
                recordInstallFailure(label, 'define_failed');
            }
        };
        const patchGetter = (label, start, property, counterKey) => {
            const located = findPropertyOwner(start, property);
            if (!located || typeof located.descriptor.get !== 'function'
                || !located.descriptor.configurable) {
                recordInstallFailure(label, 'unavailable');
                return;
            }

            const key = patchKey(located.target, property);
            if (state.patchedKeys.has(key)) return;
            const originalGet = located.descriptor.get;
            const wrappedGet = function managerBenchmarkInstrumentedGetter() {
                if (state.active) state.counters.layoutReads[counterKey] += 1;
                return originalGet.call(this);
            };
            try {
                Object.defineProperty(located.target, property, {
                    ...located.descriptor,
                    get: wrappedGet
                });
                state.patches.push({
                    descriptor: located.descriptor,
                    label,
                    property,
                    target: located.target
                });
                state.patchedKeys.add(key);
            } catch (error) {
                recordInstallFailure(label, 'define_failed');
            }
        };
        const restore = () => {
            const failures = [];
            state.active = false;
            while (state.patches.length > 0) {
                const patch = state.patches.pop();
                try {
                    Object.defineProperty(patch.target, patch.property, patch.descriptor);
                } catch (error) {
                    failures.push({ label: patch.label, reason: 'restore_failed' });
                }
            }
            state.patchedKeys.clear();
            state.restoreFailures = failures;
            return failures.length === 0;
        };
        const snapshot = () => ({
            active: state.active,
            domLayoutReadCount: sumCounts(state.counters.layoutReads),
            domLayoutReads: { ...state.counters.layoutReads },
            domQueryCallCount: sumCounts(state.counters.queries),
            domQueryCalls: { ...state.counters.queries },
            installFailureCount: state.installFailures.length,
            instrumentedApiCount: state.patches.length,
            restoreFailureCount: state.restoreFailures.length,
            restoreOk: state.restoreFailures.length === 0
        });
        const start = () => {
            if (state.patches.length > 0) restore();
            state.counters = createCounters();
            state.installFailures = [];
            state.restoreFailures = [];
            patchMethod('Document.querySelector', Document.prototype, 'querySelector', 'queries', 'querySelector');
            patchMethod('Document.querySelectorAll', Document.prototype, 'querySelectorAll', 'queries', 'querySelectorAll');
            patchMethod('DocumentFragment.querySelector', DocumentFragment.prototype, 'querySelector', 'queries', 'querySelector');
            patchMethod('DocumentFragment.querySelectorAll', DocumentFragment.prototype, 'querySelectorAll', 'queries', 'querySelectorAll');
            patchMethod('Element.querySelector', Element.prototype, 'querySelector', 'queries', 'querySelector');
            patchMethod('Element.querySelectorAll', Element.prototype, 'querySelectorAll', 'queries', 'querySelectorAll');
            patchMethod('Element.getBoundingClientRect', Element.prototype, 'getBoundingClientRect', 'layoutReads', 'getBoundingClientRect');
            patchMethod('Element.getClientRects', Element.prototype, 'getClientRects', 'layoutReads', 'getClientRects');
            patchMethod('Window.getComputedStyle', globalThis, 'getComputedStyle', 'layoutReads', 'getComputedStyle');
            for (const property of [
                'offsetHeight',
                'offsetWidth',
                'clientHeight',
                'clientWidth',
                'scrollHeight',
                'scrollWidth'
            ]) {
                patchGetter(`HTMLElement.${property}`, HTMLElement.prototype, property, property);
            }
            state.active = true;
            return snapshot();
        };

        document.addEventListener('sources-plus-manager-benchmark-command', (event) => {
            const target = event.target;
            const host = target?.id === 'sources-plus-root'
                ? target
                : document.getElementById('sources-plus-root');
            if (!host) return;

            const command = host.getAttribute('data-manager-benchmark-command');
            let result;
            if (command === 'start') {
                result = start();
            } else if (command === 'snapshot') {
                result = snapshot();
            } else if (command === 'stop') {
                const beforeRestore = snapshot();
                const restoreOk = restore();
                result = {
                    ...beforeRestore,
                    active: false,
                    restoreFailureCount: state.restoreFailures.length,
                    restoreOk
                };
            } else {
                return;
            }
            host.setAttribute('data-manager-benchmark-result', JSON.stringify(result));
        });
        globalThis.__NSM_MANAGER_BENCHMARK_INSTRUMENTATION__ = true;
    }

    return `(${instrumentContentWorld.toString()})();\n`;
}

function createBenchmarkExtensionRoot() {
    const benchmarkRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gemininotebook-manager-benchmark-'));
    const manifestPath = path.join(benchmarkRoot, 'manifest.json');
    fs.cpSync(path.join(repoRoot, 'manifest.json'), manifestPath);
    fs.cpSync(path.join(repoRoot, 'src'), path.join(benchmarkRoot, 'src'), { recursive: true });
    fs.cpSync(path.join(repoRoot, '_locales'), path.join(benchmarkRoot, '_locales'), { recursive: true });
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const instrumentationFilename = 'benchmark-manager-instrumentation.js';
    fs.writeFileSync(
        path.join(benchmarkRoot, instrumentationFilename),
        createContentInstrumentationScript(),
        'utf8'
    );
    manifest.content_scripts[0].js.unshift(instrumentationFilename);
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    return benchmarkRoot;
}

test.describe.serial('manager performance budget', () => {
    test.setTimeout(600_000);

    test('records deterministic manager interaction samples at supported scales', async () => {
        const benchmarkExtensionRoot = createBenchmarkExtensionRoot();
        let env;
        try {
            env = await launchExtensionContext(benchmarkExtensionRoot);
            await installNotebookFixture(env.context, {
                resolveSources: ({ notebookId }) => {
                    const match = String(notebookId).match(/^manager-benchmark-(\d+)$/);
                    return match ? createSyntheticSources(Number(match[1])) : null;
                }
            });
            const extensionId = await waitForExtensionId(
                env.context,
                env.userDataDir,
                benchmarkExtensionRoot
            );
            await seedBenchmarkPreferences(env.context, extensionId);
            const allResults = [];

            for (const rowCount of ROW_COUNTS) {
                const page = await env.context.newPage();
                await page.goto(`https://notebook.google.com/notebook/manager-benchmark-${rowCount}`);
                await expect(page.locator('#sources-plus-root')).toBeVisible({ timeout: 20_000 });

                const result = await page.evaluate(async ({ measuredRuns, nextRowCount, sources, warmupRuns }) => {
                    const getRoot = () => document.querySelector('#sources-plus-root')?.shadowRoot || null;
                    const benchmarkBridge = (command) => {
                        const host = document.querySelector('#sources-plus-root');
                        if (!host) throw new Error('Manager benchmark host is unavailable.');
                        host.setAttribute('data-manager-benchmark-command', command);
                        host.dispatchEvent(new Event('sources-plus-manager-benchmark-command', {
                            bubbles: true,
                            composed: true
                        }));
                        const raw = host.getAttribute('data-manager-benchmark-result');
                        if (!raw) {
                            throw new Error(`Manager benchmark command ${command} did not return a result.`);
                        }
                        return JSON.parse(raw);
                    };
                    const percentile = (values, fraction) => {
                        const sorted = values.slice().sort((left, right) => left - right);
                        const index = Math.max(
                            0,
                            Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)
                        );
                        return Number(sorted[index].toFixed(3));
                    };
                    const summarize = (values) => ({
                        p50: percentile(values, 0.5),
                        p95: percentile(values, 0.95),
                        max: Number(Math.max(...values).toFixed(3))
                    });
                    const waitFor = (read, message, timeoutMs = 60_000) => new Promise((resolve, reject) => {
                        const startedAt = performance.now();
                        const poll = () => {
                            const value = read();
                            if (value) {
                                resolve(value);
                                return;
                            }
                            if (performance.now() - startedAt >= timeoutMs) {
                                reject(new Error(message));
                                return;
                            }
                            window.setTimeout(poll, 25);
                        };
                        poll();
                    });
                    const waitForDomCommit = (
                        rootElement,
                        read,
                        message,
                        timeoutMs = 60_000
                    ) => new Promise((resolve, reject) => {
                        const initialValue = read();
                        if (initialValue) {
                            resolve(initialValue);
                            return;
                        }

                        const timeoutId = window.setTimeout(() => {
                            observer.disconnect();
                            reject(new Error(message));
                        }, timeoutMs);
                        const observer = new MutationObserver(() => {
                            const value = read();
                            if (!value) return;
                            window.clearTimeout(timeoutId);
                            observer.disconnect();
                            resolve(value);
                        });
                        observer.observe(rootElement, {
                            attributes: true,
                            characterData: true,
                            childList: true,
                            subtree: true
                        });
                    });
                    const measureSync = (action) => {
                        const startedAt = performance.now();
                        action();
                        return performance.now() - startedAt;
                    };
                    const waitForAnimationFrame = () => new Promise((resolve) => {
                        window.requestAnimationFrame(() => resolve());
                    });
                    const waitForRenderSettled = async (quietMs = 120, timeoutMs = 5000) => {
                        const startedAt = performance.now();
                        let stableSince = performance.now();
                        let previousGeneration = readManagerMetrics().renderGeneration;
                        while (performance.now() - startedAt < timeoutMs) {
                            await new Promise((resolve) => window.setTimeout(resolve, 20));
                            const currentGeneration = readManagerMetrics().renderGeneration;
                            if (currentGeneration !== previousGeneration) {
                                previousGeneration = currentGeneration;
                                stableSince = performance.now();
                                continue;
                            }
                            if (performance.now() - stableSince >= quietMs) return;
                        }
                        throw new Error('Manager render generation did not settle.');
                    };
                    const countMutationRecords = (records) => records.reduce((count, record) => {
                        if (record.type === 'childList') {
                            return count + record.addedNodes.length + record.removedNodes.length;
                        }
                        return count + 1;
                    }, 0);

                    await waitFor(() => {
                        const list = getRoot()?.querySelector('#sources-list');
                        return (
                            Number(list?.dataset?.logicalTotal) === nextRowCount
                            && Number(list?.dataset?.logicalVisible) === nextRowCount
                            && Number(list?.dataset?.materializedSources) > 0
                        );
                    }, `Manager did not project ${nextRowCount} sources.`);

                    const root = getRoot();
                    const input = root?.querySelector('#sp-search');
                    const batchButton = root?.querySelector('#sp-batch-action-btn');
                    if (!root || !input || !batchButton) {
                        throw new Error('Manager benchmark controls are unavailable.');
                    }

                    const clickAndWait = async (selector, message) => {
                        const control = await waitFor(
                            () => root.querySelector(selector),
                            message
                        );
                        control.click();
                        return control;
                    };
                    const clickQuickView = (kind) => {
                        const button = root.querySelector(`.sp-quick-view-btn[data-quick-view-kind="${kind}"]`);
                        if (!button) throw new Error(`Quick view ${kind} is unavailable.`);
                        button.click();
                    };
                    const dispatchSearchInput = (query) => {
                        input.value = query;
                        input.dispatchEvent(new Event('input', {
                            bubbles: true,
                            cancelable: true
                        }));
                    };
                    const readManagerMetrics = () => {
                        const list = root.querySelector('#sources-list');
                        return {
                            logicalTotal: Number(list?.dataset?.logicalTotal) || 0,
                            logicalVisible: Number(list?.dataset?.logicalVisible) || 0,
                            materializedSources: Number(list?.dataset?.materializedSources) || 0,
                            renderGeneration: Number(list?.dataset?.renderGeneration) || 0,
                            windowStart: Number(list?.dataset?.windowStart) || 0,
                            windowEnd: Number(list?.dataset?.windowEnd) || 0,
                            pinnedCount: Number(list?.dataset?.pinnedCount) || 0,
                            pendingSelected: Number(list?.dataset?.pendingSelected) || 0,
                            visibleSelected: Number(list?.dataset?.visibleSelected) || 0,
                            hiddenSelected: Number(list?.dataset?.hiddenSelected) || 0,
                            visibleBatchOperable: Number(list?.dataset?.visibleBatchOperable) || 0,
                            renderSetupMs: Number(list?.dataset?.renderSetupMs) || 0,
                            renderLogicalProjectionMs: Number(
                                list?.dataset?.renderLogicalProjectionMs
                            ) || 0,
                            renderProjectionFinalizeMs: Number(
                                list?.dataset?.renderProjectionFinalizeMs
                            ) || 0,
                            sourceContextIndexRebuilt: Number(
                                list?.dataset?.sourceContextIndexRebuilt
                            ) || 0,
                            derivedGroupCacheInvalidated: Number(
                                list?.dataset?.derivedGroupCacheInvalidated
                            ) || 0,
                            recomputedGroupEffectiveStateCount: Number(
                                list?.dataset?.recomputedGroupEffectiveStateCount
                            ) || 0,
                            setupFilterEvaluationCount: Number(
                                list?.dataset?.setupFilterEvaluationCount
                            ) || 0,
                            renderBaseSetupMs: Number(list?.dataset?.renderBaseSetupMs) || 0,
                            renderGroupRenderabilityMs: Number(
                                list?.dataset?.renderGroupRenderabilityMs
                            ) || 0,
                            renderSetupFinalizeMs: Number(
                                list?.dataset?.renderSetupFinalizeMs
                            ) || 0,
                            renderProjectionMs: Number(list?.dataset?.renderProjectionMs) || 0,
                            renderFragmentMs: Number(list?.dataset?.renderFragmentMs) || 0,
                            renderPatchMs: Number(list?.dataset?.renderPatchMs) || 0,
                            renderTotalMs: Number(list?.dataset?.renderTotalMs) || 0,
                            windowingActive: list?.dataset?.sourceWindowingActive === 'true'
                        };
                    };
                    const countMaterializedRows = () => (
                        root.querySelectorAll('#sources-list .source-item').length
                    );
                    const restoreAllSources = async () => {
                        clickQuickView('all');
                        await waitFor(
                            () => readManagerMetrics().logicalVisible === nextRowCount,
                            'Quick View did not restore every source.'
                        );
                    };
                    const createBenchmarkTag = async () => {
                        await clickAndWait('#sp-manage-tags-btn', 'Manage tags button is unavailable.');
                        const tagInput = await waitFor(
                            () => root.querySelector('#sp-tag-name-input'),
                            'Tag name input is unavailable.'
                        );
                        tagInput.value = 'Manager benchmark tag';
                        tagInput.dispatchEvent(new Event('input', { bubbles: true }));
                        await clickAndWait('#sp-create-tag-btn', 'Create tag button is unavailable.');
                        await clickAndWait('#sp-tag-backdrop', 'Tag backdrop is unavailable.');
                        await clickAndWait(
                            '.source-item .sp-source-actions-button',
                            'Source actions button is unavailable.'
                        );
                        await clickAndWait(
                            '.sp-source-actions-menu-item[data-action="tags"]',
                            'Source tag action is unavailable.'
                        );
                        await clickAndWait(
                            '.sp-tag-option-checkbox',
                            'Source tag checkbox is unavailable.'
                        );
                        await clickAndWait('#sp-save-tags-btn', 'Save tag assignment is unavailable.');
                        await waitFor(
                            () => root.querySelector('.sp-tag-pill'),
                            'Assigned benchmark tag did not render.'
                        );
                    };
                    await createBenchmarkTag();

                    const runSample = async (index, capture, forceFailure = false) => {
                        let domMutationCount = 0;
                        let mutationObserverActive = false;
                        let instrumentationStarted = false;
                        const mutationObserver = new MutationObserver((records) => {
                            domMutationCount += countMutationRecords(records);
                        });
                        mutationObserver.observe(root, {
                            attributes: true,
                            characterData: true,
                            childList: true,
                            subtree: true
                        });
                        mutationObserverActive = true;
                        const stopInstrumentation = () => {
                            const snapshot = benchmarkBridge('stop');
                            instrumentationStarted = false;
                            if (!snapshot?.restoreOk) {
                                throw new Error('Manager benchmark DOM instrumentation did not restore cleanly.');
                            }
                            return snapshot;
                        };

                        try {
                            instrumentationStarted = true;
                            const instrumentationStart = benchmarkBridge('start');
                            if (Number(instrumentationStart?.instrumentedApiCount) < 1) {
                                throw new Error('Manager benchmark DOM instrumentation is unavailable.');
                            }
                            if (forceFailure) {
                                throw new Error('manager_benchmark_intentional_cleanup_check');
                            }

                            const sampleSources = sources.map((source, sourceIndex) => (
                            sourceIndex === 0
                                ? {
                                    ...source,
                                    title: `${source.title} sample-${index}`
                                }
                                : source
                            ));
                            const initialRenderStartedAt = performance.now();
                            const previousRenderGeneration = readManagerMetrics().renderGeneration;
                            const replaceResult = window.__replaceNotebookSources(sampleSources);
                            if (!replaceResult?.success) {
                                throw new Error('Manager benchmark source replacement failed.');
                            }
                            try {
                            await waitForDomCommit(
                                root,
                                () => {
                                    const metrics = readManagerMetrics();
                                    return (
                                        metrics.renderGeneration > previousRenderGeneration
                                        && metrics.logicalTotal === nextRowCount
                                        && metrics.logicalVisible === nextRowCount
                                        && root.querySelector('.source-title-text')
                                            ?.textContent
                                            ?.includes(`sample-${index}`)
                                    );
                                },
                                `Manager initial render ${index} did not complete.`
                            );
                            } catch (error) {
                            const firstTitle = root.querySelector('.source-title-text')
                                ?.textContent
                                || '';
                            const metrics = readManagerMetrics();
                            throw new Error(
                                `Manager initial render ${index} did not complete: `
                                + `logical=${metrics.logicalVisible}, `
                                + `materialized=${metrics.materializedSources}, `
                                + `firstTitle=${firstTitle}.`
                            );
                            }
                            await waitForAnimationFrame();
                            await waitForRenderSettled();
                        const initialRender = performance.now() - initialRenderStartedAt;

                        const query = 'Manager benchmark source 00001';
                        const searchRenderStartedAt = performance.now();
                        const syncInput = measureSync(() => dispatchSearchInput(query));
                        await waitForDomCommit(
                            root,
                            () => readManagerMetrics().logicalVisible === 1,
                            'Search render did not narrow the source list.'
                        );
                        const searchRender = performance.now() - searchRenderStartedAt;
                        const searchMetrics = readManagerMetrics();
                        dispatchSearchInput('');
                        await waitFor(
                            () => readManagerMetrics().logicalVisible === nextRowCount,
                            'Clearing search did not restore every source.'
                        );

                        const quickViewStartedAt = performance.now();
                        clickQuickView('issues');
                        await waitForDomCommit(
                            root,
                            () => readManagerMetrics().logicalVisible === 0,
                            'Issues Quick View did not finish rendering.'
                        );
                        const quickView = performance.now() - quickViewStartedAt;
                        await restoreAllSources();

                        const tagPill = await waitFor(
                            () => root.querySelector('.sp-tag-pill'),
                            'Benchmark tag pill is unavailable.'
                        );
                        const tagFilterStartedAt = performance.now();
                        tagPill.click();
                        await waitForDomCommit(
                            root,
                            () => (
                                readManagerMetrics().logicalVisible === 1
                                && root.querySelector('.sp-tag-pill')?.getAttribute('aria-pressed') === 'true'
                            ),
                            'Tag filter did not finish rendering.'
                        );
                        const tagFilter = performance.now() - tagFilterStartedAt;
                        root.querySelector('.sp-tag-pill')?.click();
                        await waitFor(
                            () => readManagerMetrics().logicalVisible === nextRowCount,
                            'Clearing tag filter did not restore every source.'
                        );

                        if (!root.querySelector('.sp-batch-checkbox')) batchButton.click();
                        await waitFor(
                            () => {
                                const metrics = readManagerMetrics();
                                return (
                                    metrics.visibleBatchOperable === nextRowCount
                                    && root.querySelectorAll('.sp-batch-checkbox').length
                                        === metrics.materializedSources
                                );
                            },
                            'Batch mode did not expose the complete logical selection set.'
                        );
                        const selectButton = root.querySelector('.sp-batch-select-visible-btn');
                        if (!selectButton) throw new Error('Select visible action is unavailable.');
                        const batchSelectStartedAt = performance.now();
                        selectButton.click();
                        await waitForDomCommit(
                            root,
                            () => {
                                const metrics = readManagerMetrics();
                                return (
                                    metrics.pendingSelected === nextRowCount
                                    && metrics.visibleSelected === nextRowCount
                                    && metrics.hiddenSelected === 0
                                    && root.querySelectorAll('.sp-batch-checkbox:checked').length
                                        === metrics.materializedSources
                                );
                            },
                            'Batch selection did not select every visible source.'
                        );
                        const batchSelect = performance.now() - batchSelectStartedAt;
                        batchButton.click();
                        await waitFor(
                            () => !root.querySelector('.sp-batch-checkbox'),
                            'Batch mode did not close.'
                        );

                        await waitForAnimationFrame();
                        domMutationCount += countMutationRecords(mutationObserver.takeRecords());
                        mutationObserver.disconnect();
                        mutationObserverActive = false;
                        const instrumentationSnapshot = stopInstrumentation();
                        if (!capture) return null;
                        return {
                            initialRender,
                            syncInput,
                            searchRender,
                            searchSetup: searchMetrics.renderSetupMs,
                            searchBaseSetup: searchMetrics.renderBaseSetupMs,
                            searchGroupRenderability:
                                searchMetrics.renderGroupRenderabilityMs,
                            searchSetupFinalize: searchMetrics.renderSetupFinalizeMs,
                            searchLogicalProjection: searchMetrics.renderLogicalProjectionMs,
                            searchProjectionFinalize: searchMetrics.renderProjectionFinalizeMs,
                            searchContextIndexRebuilt: searchMetrics.sourceContextIndexRebuilt,
                            searchGroupCacheInvalidated: searchMetrics.derivedGroupCacheInvalidated,
                            searchGroupEffectiveRecomputed:
                                searchMetrics.recomputedGroupEffectiveStateCount,
                            searchSetupFilterEvaluations:
                                searchMetrics.setupFilterEvaluationCount,
                            searchProjection: searchMetrics.renderProjectionMs,
                            searchFragment: searchMetrics.renderFragmentMs,
                            searchPatch: searchMetrics.renderPatchMs,
                            searchRenderTotal: searchMetrics.renderTotalMs,
                            searchScheduling: Math.max(
                                0,
                                searchRender - searchMetrics.renderTotalMs
                            ),
                            quickView,
                            tagFilter,
                            batchSelect,
                            domMutationCount,
                            domInstrumentationApiCount: instrumentationSnapshot.instrumentedApiCount,
                            domInstrumentationInstallFailureCount:
                                instrumentationSnapshot.installFailureCount,
                            domInstrumentationRestoreFailureCount:
                                instrumentationSnapshot.restoreFailureCount,
                            domLayoutReadCount: instrumentationSnapshot.domLayoutReadCount,
                            domLayoutReads: instrumentationSnapshot.domLayoutReads,
                            domQueryCallCount: instrumentationSnapshot.domQueryCallCount,
                            domQueryCalls: instrumentationSnapshot.domQueryCalls
                        };
                        } finally {
                            if (mutationObserverActive) {
                                domMutationCount += countMutationRecords(mutationObserver.takeRecords());
                                mutationObserver.disconnect();
                            }
                            if (instrumentationStarted) stopInstrumentation();
                        }
                    };

                    let instrumentationFailureCleanupVerified = false;
                    try {
                        await runSample(-1, false, true);
                    } catch (error) {
                        if (error?.message !== 'manager_benchmark_intentional_cleanup_check') {
                            throw error;
                        }
                        instrumentationFailureCleanupVerified = true;
                    }
                    const afterFailureCleanup = benchmarkBridge('snapshot');
                    if (!instrumentationFailureCleanupVerified || afterFailureCleanup.active
                        || afterFailureCleanup.instrumentedApiCount !== 0
                        || !afterFailureCleanup.restoreOk) {
                        throw new Error('Manager benchmark DOM instrumentation cleanup was incomplete.');
                    }

                    for (let index = 0; index < warmupRuns; index += 1) {
                        await runSample(index, false);
                    }
                    const samples = [];
                    for (let index = 0; index < measuredRuns; index += 1) {
                        samples.push(await runSample(warmupRuns + index, true));
                    }

                    return {
                        rowCount: nextRowCount,
                        warmupRuns,
                        measuredRuns,
                        instrumentationFailureCleanupVerified,
                        initialRenderMs: summarize(samples.map((sample) => sample.initialRender)),
                        syncInputMs: summarize(samples.map((sample) => sample.syncInput)),
                        searchRenderMs: summarize(samples.map((sample) => sample.searchRender)),
                        searchSetupMs: summarize(samples.map((sample) => sample.searchSetup)),
                        searchBaseSetupMs: summarize(
                            samples.map((sample) => sample.searchBaseSetup)
                        ),
                        searchGroupRenderabilityMs: summarize(
                            samples.map((sample) => sample.searchGroupRenderability)
                        ),
                        searchSetupFinalizeMs: summarize(
                            samples.map((sample) => sample.searchSetupFinalize)
                        ),
                        searchLogicalProjectionMs: summarize(
                            samples.map((sample) => sample.searchLogicalProjection)
                        ),
                        searchProjectionFinalizeMs: summarize(
                            samples.map((sample) => sample.searchProjectionFinalize)
                        ),
                        searchContextIndexRebuilt: summarize(
                            samples.map((sample) => sample.searchContextIndexRebuilt)
                        ),
                        searchGroupCacheInvalidated: summarize(
                            samples.map((sample) => sample.searchGroupCacheInvalidated)
                        ),
                        searchGroupEffectiveRecomputed: summarize(
                            samples.map((sample) => sample.searchGroupEffectiveRecomputed)
                        ),
                        searchSetupFilterEvaluations: summarize(
                            samples.map((sample) => sample.searchSetupFilterEvaluations)
                        ),
                        searchProjectionMs: summarize(samples.map((sample) => sample.searchProjection)),
                        searchFragmentMs: summarize(samples.map((sample) => sample.searchFragment)),
                        searchPatchMs: summarize(samples.map((sample) => sample.searchPatch)),
                        searchRenderTotalMs: summarize(samples.map((sample) => sample.searchRenderTotal)),
                        searchSchedulingMs: summarize(samples.map((sample) => sample.searchScheduling)),
                        quickViewMs: summarize(samples.map((sample) => sample.quickView)),
                        tagFilterMs: summarize(samples.map((sample) => sample.tagFilter)),
                        batchSelectMs: summarize(samples.map((sample) => sample.batchSelect)),
                        domInstrumentationApiCount: summarize(
                            samples.map((sample) => sample.domInstrumentationApiCount)
                        ),
                        domInstrumentationInstallFailureCount: summarize(
                            samples.map((sample) => sample.domInstrumentationInstallFailureCount)
                        ),
                        domInstrumentationRestoreFailureCount: samples.reduce(
                            (total, sample) => total + sample.domInstrumentationRestoreFailureCount,
                            0
                        ),
                        domQueryCallCount: summarize(samples.map((sample) => sample.domQueryCallCount)),
                        domQueryCalls: {
                            querySelector: summarize(
                                samples.map((sample) => sample.domQueryCalls.querySelector)
                            ),
                            querySelectorAll: summarize(
                                samples.map((sample) => sample.domQueryCalls.querySelectorAll)
                            )
                        },
                        domLayoutReadCount: summarize(
                            samples.map((sample) => sample.domLayoutReadCount)
                        ),
                        domLayoutReads: {
                            getBoundingClientRect: summarize(
                                samples.map((sample) => sample.domLayoutReads.getBoundingClientRect)
                            ),
                            getClientRects: summarize(
                                samples.map((sample) => sample.domLayoutReads.getClientRects)
                            ),
                            getComputedStyle: summarize(
                                samples.map((sample) => sample.domLayoutReads.getComputedStyle)
                            ),
                            offsetHeight: summarize(
                                samples.map((sample) => sample.domLayoutReads.offsetHeight)
                            ),
                            offsetWidth: summarize(
                                samples.map((sample) => sample.domLayoutReads.offsetWidth)
                            ),
                            clientHeight: summarize(
                                samples.map((sample) => sample.domLayoutReads.clientHeight)
                            ),
                            clientWidth: summarize(
                                samples.map((sample) => sample.domLayoutReads.clientWidth)
                            ),
                            scrollHeight: summarize(
                                samples.map((sample) => sample.domLayoutReads.scrollHeight)
                            ),
                            scrollWidth: summarize(
                                samples.map((sample) => sample.domLayoutReads.scrollWidth)
                            )
                        },
                        domMutationCount: summarize(samples.map((sample) => sample.domMutationCount)),
                        logicalRows: readManagerMetrics().logicalVisible,
                        materializedRows: countMaterializedRows(),
                        sourceWindow: readManagerMetrics(),
                        environment: {
                            userAgent: navigator.userAgent,
                            chromium: navigator.userAgent.match(/(?:Chrome|Chromium)\/[\d.]+/)?.[0] || 'unknown',
                            platform: navigator.platform,
                            logicalProcessors: navigator.hardwareConcurrency || null
                        }
                    };
                }, {
                    measuredRuns: MEASURED_RUNS,
                    nextRowCount: rowCount,
                    sources: createSyntheticSources(rowCount),
                    warmupRuns: WARMUP_RUNS
                });

                const interactionBudgetMs = rowCount <= 1000 ? 100 : 250;
                allResults.push(result);
                console.log('MANAGER_BENCHMARK_SCALE_RESULT', JSON.stringify(result));
                expect(result.logicalRows).toBe(rowCount);
                expect(result.instrumentationFailureCleanupVerified).toBe(true);
                expect(result.materializedRows).toBe(result.sourceWindow.materializedSources);
                expect(result.domInstrumentationApiCount.p50).toBe(
                    EXPECTED_INSTRUMENTED_API_COUNT
                );
                expect(result.domInstrumentationApiCount.p95).toBe(
                    EXPECTED_INSTRUMENTED_API_COUNT
                );
                expect(result.domInstrumentationInstallFailureCount.max).toBe(0);
                expect(result.domInstrumentationRestoreFailureCount).toBe(0);
                expect(result.domQueryCallCount.p50).toBeGreaterThan(0);
                expect(result.domLayoutReadCount.p50).toBeGreaterThan(0);
                expect(result.materializedRows).toBeLessThanOrEqual(
                    (result.sourceWindow.windowEnd - result.sourceWindow.windowStart)
                    + result.sourceWindow.pinnedCount
                );
                if (rowCount >= 500) {
                    expect(result.sourceWindow.windowingActive).toBe(true);
                    expect(result.materializedRows).toBeLessThan(rowCount);
                }
                result.interactionBudgetMs = interactionBudgetMs;
                await page.close();
            }

            console.log('MANAGER_BENCHMARK_RESULT', JSON.stringify({
                commitSha: resolveCommitSha(),
                nodePlatform: process.platform,
                cpuModel: os.cpus()?.[0]?.model || 'unknown',
                results: allResults
            }));
            expect(allResults).toHaveLength(ROW_COUNTS.length);
            allResults.forEach((result) => {
                expect(result.syncInputMs.p95).toBeLessThanOrEqual(16);
                expect(result.searchRenderMs.p95).toBeLessThanOrEqual(
                    result.interactionBudgetMs
                );
                expect(result.quickViewMs.p95).toBeLessThanOrEqual(
                    result.interactionBudgetMs
                );
                expect(result.tagFilterMs.p95).toBeLessThanOrEqual(
                    result.interactionBudgetMs
                );
                expect(result.batchSelectMs.p95).toBeLessThanOrEqual(
                    result.interactionBudgetMs
                );
            });
        } finally {
            if (env) await closeExtensionContext(env);
            fs.rmSync(benchmarkExtensionRoot, { recursive: true, force: true });
        }
    });
});
