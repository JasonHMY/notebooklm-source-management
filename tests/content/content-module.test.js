const fs = require('fs');
const path = require('path');
const {
    CONTENT_HELPER_GLOBALS,
    setupGlobalMocks,
    teardownGlobalMocks,
    loadContentModule,
    loadFreshContentModule,
    createMockSourceRow,
    createMockImageCandidate,
    createSearchUiMock,
    createMockPanel,
    createInitShadowRoot,
    createTreeEl
} = require('../helpers/content-test-harness');

describe('content module loading', () => {
    afterEach(teardownGlobalMocks);

    it('reloads the sidecar factories cleanly between runs', () => {
        jest.resetModules();
        setupGlobalMocks();

        loadContentModule();
        const firstFactories = Object.fromEntries(
            CONTENT_HELPER_GLOBALS
                .filter((key) => key.startsWith('NSM_CREATE_CONTENT_'))
                .map((key) => [key, global[key]])
        );

        expect(Object.values(firstFactories).every((factory) => typeof factory === 'function')).toBe(true);
        expect(typeof global.NSM_CREATE_CONTENT_TREE_PLACEMENT).toBe('function');
        expect(typeof global.NSM_SOURCE_DESCRIPTOR_HELPERS).toBe('object');

        teardownGlobalMocks();
        CONTENT_HELPER_GLOBALS.forEach((key) => {
            expect(global[key]).toBeUndefined();
        });

        jest.resetModules();
        setupGlobalMocks();
        loadContentModule();

        Object.entries(firstFactories).forEach(([key, factory]) => {
            expect(typeof global[key]).toBe('function');
            expect(global[key]).not.toBe(factory);
        });
    });

    it('wires the row-replacement render seam to drag geometry invalidation', () => {
        const indexSource = fs.readFileSync(
            path.join(__dirname, '../../src/content/index.js'),
            'utf8'
        );
        const renderSource = fs.readFileSync(
            path.join(__dirname, '../../src/content/content-render.js'),
            'utf8'
        );

        expect(indexSource).toContain('onBeforeRowsPatch: () => {');
        expect(indexSource).toContain(
            "treeInteractionsModule.invalidateDragGeometry('render_rows_replaced');"
        );
        expect(renderSource).toContain("typeof deps.onBeforeRowsPatch === 'function'");
        expect(renderSource).toContain('deps.onBeforeRowsPatch();');
    });

    it('creates one search semantics instance and injects it into both consumers', () => {
        const indexSource = fs.readFileSync(
            path.join(__dirname, '../../src/content/index.js'),
            'utf8'
        );

        expect(indexSource.match(/createContentSearchSemantics\(\{/g)).toHaveLength(1);
        expect(indexSource.match(/searchSemantics: searchSemanticsModule/g)).toHaveLength(2);
    });
});

describe('content stylesheet native source list visibility', () => {
    it('only hides the native source list while the manager is active', () => {
        const css = fs.readFileSync(path.join(__dirname, '../../src/content/styles.css'), 'utf8');
        const firstRule = css.slice(0, css.indexOf('{'));

        expect(firstRule).toContain('.sources-plus-manager-active .source-panel .scroll-area-desktop');
        expect(firstRule).toContain('.sources-plus-manager-active .source-panel .source-label-group');
        expect(firstRule).toContain('.sources-plus-manager-active .source-panel mat-expansion-panel');
        expect(firstRule).toContain('.sources-plus-manager-active .source-panel mat-accordion');
        expect(firstRule).not.toContain('\n.source-panel .scroll-area-desktop');
        expect(firstRule).not.toContain('\n.source-panel .source-label-group');
        expect(firstRule).not.toContain('.source-label-controls');
        expect(firstRule).not.toContain('#sources-plus-root ~ *');
    });

    it('keeps native NotebookLM menu motion explicit and reduced-motion aware', () => {
        const css = fs.readFileSync(path.join(__dirname, '../../src/content/styles.css'), 'utf8');

        expect(css).toContain('var(--sp-motion-medium, 240ms)');
        expect(css).toContain('var(--sp-ease-emphasized, cubic-bezier(0.2, 0.9, 0.25, 1))');
        expect(css).not.toContain('transition: all');
        expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    });
});

describe('manifest web accessible resources', () => {
    it('exposes the local Google Symbols font and locale catalogs only to NotebookLM pages', () => {
        const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../../manifest.json'), 'utf8'));
        const fontPath = 'src/assets/fonts/google-symbols.woff2';
        const fontResource = (manifest.web_accessible_resources || [])
            .find((entry) => Array.isArray(entry.resources) && entry.resources.includes(fontPath));
        const expectedResources = [
            fontPath,
            '_locales/en/messages.json',
            '_locales/es/messages.json',
            '_locales/zh_CN/messages.json',
        ];

        expect(fs.existsSync(path.join(__dirname, '../../', fontPath))).toBe(true);
        expectedResources.forEach((resourcePath) => {
            expect(fs.existsSync(path.join(__dirname, '../../', resourcePath))).toBe(true);
        });
        expect(fontResource).toBeTruthy();
        expect(fontResource.resources).toEqual(expectedResources);
        expect(fontResource.matches).toEqual(['https://notebooklm.google.com/*']);
        expect(manifest.permissions).toEqual(['storage', 'tabs']);
    });
});

describe('content bootstrap toggle gating', () => {
    afterEach(teardownGlobalMocks);

    it('starts disabled when the background toggle is off', async () => {
        jest.resetModules();
        setupGlobalMocks();
        global.chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            if (message.type === 'GET_EXTENSION_ENABLED' && typeof cb === 'function') {
                cb({ success: true, enabled: false });
                return;
            }

            if (typeof cb === 'function') {
                cb({ success: true });
            }
        });

        const mod = loadContentModule();
        await Promise.resolve();
        await Promise.resolve();

        expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
            { type: 'GET_EXTENSION_ENABLED' },
            expect.any(Function)
        );
        expect(mod._getExtensionEnabledForTest()).toBe(false);
        expect(mod.getManagerStatus()).toEqual({
            ready: false,
            reason: 'extension_disabled'
        });
    });
});
