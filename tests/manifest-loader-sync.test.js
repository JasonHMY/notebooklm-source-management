const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(REPO_ROOT, 'manifest.json');
const LOADER_PATH = path.join(REPO_ROOT, 'tests/helpers/load-content-module.js');

function getManifestContentJsList() {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const jsList = manifest.content_scripts[0].js;
    return jsList
        .filter((entry) => entry.startsWith('src/content/'))
        .map((entry) => entry.replace(/^src\/content\//, ''));
}

function getLoaderRequireList() {
    const source = fs.readFileSync(LOADER_PATH, 'utf8');
    const matches = source.matchAll(/require\(['"]\.\.\/\.\.\/src\/content\/([^'"]+)['"]\)/g);
    return Array.from(matches, (m) => m[1]);
}

function getLoaderClearGlobalsList() {
    const source = fs.readFileSync(LOADER_PATH, 'utf8');
    const matches = source.matchAll(/delete globalThis\.(NSM_[A-Z0-9_]+);/g);
    return Array.from(matches, (m) => m[1]);
}

describe('manifest <-> load-content-module sync', () => {
    it('manifest content_scripts and loader require() the same files in the same order', () => {
        const manifestFiles = getManifestContentJsList();
        const loaderFiles = getLoaderRequireList();

        expect(loaderFiles).toEqual(manifestFiles);
    });

    it('every file the loader requires actually exists on disk', () => {
        const loaderFiles = getLoaderRequireList();
        loaderFiles.forEach((file) => {
            const fullPath = path.join(REPO_ROOT, 'src/content', file);
            expect(fs.existsSync(fullPath)).toBe(true);
        });
    });

    it('clearContentGlobals() deletes at least one NSM_* global per helper module', () => {
        const loaderFiles = getLoaderRequireList();
        const clearedGlobals = getLoaderClearGlobalsList();

        const helperCount = loaderFiles.filter((file) => file !== 'index.js').length;
        expect(clearedGlobals.length).toBeGreaterThanOrEqual(helperCount);
    });
});
