const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const pkg = require('../package.json');
const DEFAULT_BASE_DIR = path.resolve(__dirname, '..');

const REQUIRED_ENTRIES = [
  'manifest.json',
  'src/',
  '_locales/'
];

const ALLOWED_ENTRY_PATTERNS = [
  /^manifest\.json$/,
  /^PRIVACY\.md$/,
  /^src\//,
  /^_locales\//
];

const FORBIDDEN_ENTRY_PATTERNS = [
  /(^|\/)\.DS_Store$/,
  /^node_modules\//,
  /^tests\//,
  /^release\//,
  /^output\//,
  /^\.git\//,
  /^\.agents?\//,
  /^\.cursor\//,
  /^\.superpowers\//,
  /^docs\/superpowers\/plans\//
];

function getReleasePaths(baseDir = DEFAULT_BASE_DIR, version = pkg.version) {
  const releaseDir = path.join(baseDir, 'release');
  const zipName = `${pkg.name}-${version}.zip`;
  return {
    releaseDir,
    zipName,
    zipPath: path.join(releaseDir, zipName)
  };
}

async function ensureReleaseDir(releaseDir) {
  await fs.promises.rm(releaseDir, { recursive: true, force: true });
  await fs.promises.mkdir(releaseDir, { recursive: true });
}

function getPackageEntries(baseDir = DEFAULT_BASE_DIR) {
  const entries = [];
  const addFile = (absolutePath, zipPath) => {
    if (!fs.existsSync(absolutePath)) return;
    entries.push({
      sourcePath: absolutePath,
      targetPath: normalizeZipPath(zipPath)
    });
  };

  addFile(path.join(baseDir, 'manifest.json'), 'manifest.json');
  collectDirectoryEntries(path.join(baseDir, 'src'), 'src', entries);
  collectDirectoryEntries(path.join(baseDir, '_locales'), '_locales', entries);
  addFile(path.join(baseDir, 'PRIVACY.md'), 'PRIVACY.md');
  return entries;
}

function normalizeZipPath(entryPath) {
  return String(entryPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function collectDirectoryEntries(absoluteDir, zipDir, entries) {
  if (!fs.existsSync(absoluteDir)) return;

  for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') continue;

    const sourcePath = path.join(absoluteDir, entry.name);
    const targetPath = path.posix.join(zipDir, entry.name);

    if (entry.isDirectory()) {
      collectDirectoryEntries(sourcePath, targetPath, entries);
      continue;
    }

    entries.push({
      sourcePath,
      targetPath: normalizeZipPath(targetPath)
    });
  }
}

function assertPackageEntries(entries) {
  const targetPaths = (Array.isArray(entries) ? entries : []).map((entry) => normalizeZipPath(entry.targetPath));
  const missingRequiredEntries = REQUIRED_ENTRIES.filter((requiredEntry) => {
    if (requiredEntry.endsWith('/')) {
      return !targetPaths.some((targetPath) => targetPath.startsWith(requiredEntry));
    }
    return !targetPaths.includes(requiredEntry);
  });

  if (missingRequiredEntries.length > 0) {
    throw new Error(`Package is missing required entries: ${missingRequiredEntries.join(', ')}`);
  }

  const unexpectedEntries = targetPaths.filter((targetPath) => (
    !ALLOWED_ENTRY_PATTERNS.some((pattern) => pattern.test(targetPath))
  ));
  if (unexpectedEntries.length > 0) {
    throw new Error(`Package contains unexpected entries: ${unexpectedEntries.join(', ')}`);
  }

  const forbiddenEntries = targetPaths.filter((targetPath) => (
    FORBIDDEN_ENTRY_PATTERNS.some((pattern) => pattern.test(targetPath))
  ));
  if (forbiddenEntries.length > 0) {
    throw new Error(`Package contains forbidden entries: ${forbiddenEntries.join(', ')}`);
  }

  return true;
}

function archiveFiles(archive, options = {}) {
  const baseDir = options.baseDir || DEFAULT_BASE_DIR;
  const entries = options.entries || getPackageEntries(baseDir);
  assertPackageEntries(entries);
  entries.forEach((entry) => {
    archive.file(entry.sourcePath, { name: entry.targetPath });
  });
  return entries;
}

async function buildZip(options = {}) {
  const baseDir = options.baseDir || DEFAULT_BASE_DIR;
  const { releaseDir, zipPath } = getReleasePaths(baseDir, pkg.version);
  await ensureReleaseDir(releaseDir);
  const output = fs.createWriteStream(zipPath);
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.pipe(output);
  const entries = archiveFiles(archive, { baseDir });
  await archive.finalize();

  await new Promise((resolve, reject) => {
    output.on('close', resolve);
    output.on('error', reject);
  });
  console.log(`Packaged ${entries.length} files at ${zipPath}`);
  return { zipPath, entries };
}

if (require.main === module) {
  buildZip().catch((error) => {
    console.error('Packaging failed:', error);
    process.exit(1);
  });
}

module.exports = {
  REQUIRED_ENTRIES,
  ALLOWED_ENTRY_PATTERNS,
  FORBIDDEN_ENTRY_PATTERNS,
  getReleasePaths,
  getPackageEntries,
  assertPackageEntries,
  archiveFiles,
  buildZip
};
