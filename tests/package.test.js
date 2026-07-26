const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    getReleasePaths,
    getPackageEntries,
    assertPackageEntries,
    archiveFiles
} = require('../scripts/package');

function writeFile(filePath, contents = '') {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
}

describe('package script', () => {
    let tempDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nlm-package-'));
        writeFile(path.join(tempDir, 'manifest.json'), '{"manifest_version":3}');
        writeFile(path.join(tempDir, 'src/content/index.js'), 'console.log("content");');
        writeFile(path.join(tempDir, '_locales/en/messages.json'), '{}');
        writeFile(path.join(tempDir, 'PRIVACY.md'), '# Privacy');
        writeFile(path.join(tempDir, 'tests/content.test.js'), 'test("skip", () => {});');
        writeFile(path.join(tempDir, 'output/debug.json'), '{}');
        writeFile(path.join(tempDir, '.superpowers/state.json'), '{}');
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('uses the canonical product slug for the release zip', () => {
        const releasePaths = getReleasePaths(tempDir, '1.2.3');

        expect(releasePaths.zipName).toBe('gemininotebook-source-management-1.2.3.zip');
        expect(releasePaths.zipPath).toBe(path.join(tempDir, 'release', releasePaths.zipName));
    });

    it('collects only runtime extension files', () => {
        const entries = getPackageEntries(tempDir);
        const targetPaths = entries.map((entry) => entry.targetPath).sort();

        expect(targetPaths).toEqual([
            'PRIVACY.md',
            '_locales/en/messages.json',
            'manifest.json',
            'src/content/index.js'
        ]);
        expect(assertPackageEntries(entries)).toBe(true);
    });

    it('rejects forbidden or unexpected zip entries', () => {
        expect(() => assertPackageEntries([
            { targetPath: 'manifest.json' },
            { targetPath: 'src/content/index.js' },
            { targetPath: '_locales/en/messages.json' },
            { targetPath: 'tests/content.test.js' }
        ])).toThrow(/unexpected entries|forbidden entries/);
    });

    it('archives entries after validating the package list', () => {
        const archive = { file: jest.fn() };
        const entries = archiveFiles(archive, { baseDir: tempDir });

        expect(entries).toHaveLength(4);
        expect(archive.file).toHaveBeenCalledWith(
            path.join(tempDir, 'manifest.json'),
            { name: 'manifest.json' }
        );
        expect(archive.file).not.toHaveBeenCalledWith(
            expect.stringContaining('tests'),
            expect.any(Object)
        );
    });

    it('keeps the extension icon assets in the release package', () => {
        const repoRoot = path.resolve(__dirname, '..');
        const packagedPaths = new Set(getPackageEntries(repoRoot).map((entry) => entry.targetPath));

        [
            'src/assets/icons/1.png',
            'src/assets/icons/icon16.png',
            'src/assets/icons/icon32.png',
            'src/assets/icons/icon48.png',
            'src/assets/icons/icon128.png'
        ].forEach((iconPath) => {
            expect(fs.existsSync(path.join(repoRoot, iconPath))).toBe(true);
            expect(packagedPaths.has(iconPath)).toBe(true);
        });
    });
});
