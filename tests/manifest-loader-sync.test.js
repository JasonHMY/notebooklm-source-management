const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(REPO_ROOT, 'manifest.json');
const LOADER_PATH = path.join(REPO_ROOT, 'tests/helpers/load-content-module.js');

function getManifestRuntimeJsList() {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const jsList = manifest.content_scripts[0].js;
    return jsList
        .filter((entry) => (
            entry.startsWith('src/utils/')
            || entry.startsWith('src/content/')
        ));
}

function getLoaderRequireList() {
    const source = fs.readFileSync(LOADER_PATH, 'utf8');
    const matches = source.matchAll(/require\(['"]\.\.\/\.\.\/(src\/(?:utils|content)\/[^'"]+)['"]\)/g);
    return Array.from(matches, (m) => m[1]);
}

function getLoaderClearGlobalsList() {
    const source = fs.readFileSync(LOADER_PATH, 'utf8');
    const matches = source.matchAll(/delete globalThis\.(NSM_[A-Z0-9_]+);/g);
    return Array.from(matches, (m) => m[1]);
}

describe('manifest <-> load-content-module sync', () => {
    it('manifest content_scripts and loader require() the same files in the same order', () => {
        const manifestFiles = getManifestRuntimeJsList();
        const loaderFiles = getLoaderRequireList();

        expect(loaderFiles).toEqual(manifestFiles);
    });

    it('every file the loader requires actually exists on disk', () => {
        const loaderFiles = getLoaderRequireList();
        loaderFiles.forEach((file) => {
            const fullPath = path.join(REPO_ROOT, file);
            expect(fs.existsSync(fullPath)).toBe(true);
        });
    });

    it('loads the shared storage contract before every content storage consumer', () => {
        const manifestFiles = getManifestRuntimeJsList();
        const loaderFiles = getLoaderRequireList();
        const storageContractPath = 'src/utils/storage-contract.js';
        const consumers = [
            'src/content/content-config.js',
            'src/content/content-persistence.js',
            'src/content/content-import-export.js',
            'src/content/content-developer-logger.js'
        ];

        expect(manifestFiles).toContain(storageContractPath);
        expect(loaderFiles).toContain(storageContractPath);
        consumers.forEach((consumer) => {
            expect(manifestFiles.indexOf(storageContractPath))
                .toBeLessThan(manifestFiles.indexOf(consumer));
            expect(loaderFiles.indexOf(storageContractPath))
                .toBeLessThan(loaderFiles.indexOf(consumer));
        });
    });

    it('clearContentGlobals() deletes at least one NSM_* global per helper module', () => {
        const loaderFiles = getLoaderRequireList();
        const clearedGlobals = getLoaderClearGlobalsList();

        const helperCount = loaderFiles.filter((file) => !file.endsWith('/index.js')).length;
        expect(clearedGlobals.length).toBeGreaterThanOrEqual(helperCount);
    });

    it('loader clearContentGlobals() and harness CONTENT_HELPER_GLOBALS enumerate the exact same NSM_* globals', () => {
        // Bidirectional guard for the module-sync invariant: the loader teardown deletes and
        // the harness array must stay in lockstep. A new content module added to one but not
        // the other drifts silently — the omission direction the manifest<->loader ORDER
        // check above cannot catch (that one only compares require()s to manifest entries).
        const clearedGlobals = getLoaderClearGlobalsList();
        const { CONTENT_HELPER_GLOBALS } = require('./helpers/content-test-harness');

        expect([...clearedGlobals].sort()).toEqual([...CONTENT_HELPER_GLOBALS].sort());
    });
});
