const fs = require('fs');
const os = require('os');
const path = require('path');

const { chromium } = require('@playwright/test');

// Explicit override only. Otherwise Playwright's bundled Chromium is used (channel 'chromium'),
// which loads unpacked extensions in headless mode; branded Google Chrome ignores --load-extension.
function resolveChromiumExecutablePath() {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
}

let browserVersionLogged = false;
const extensionIdByContext = new WeakMap();

function createUserDataDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'nlm-source-smoke-'));
}

function ensurePlaywrightArtifactDirs() {
    const artifactsRoot = path.join(
        process.cwd(),
        'output',
        'playwright',
        '.playwright-artifacts-0'
    );

    fs.mkdirSync(path.join(artifactsRoot, 'traces'), { recursive: true });
    fs.mkdirSync(path.join(artifactsRoot, 'resources'), { recursive: true });
}

function shouldRunHeadless() {
    if (process.env.PLAYWRIGHT_HEADLESS === 'false') return false;
    return true;
}

function readExtensionIdFromPreferences(userDataDir, repoRoot) {
    const preferencesPath = path.join(userDataDir, 'Default', 'Preferences');
    if (!fs.existsSync(preferencesPath)) {
        return null;
    }

    const preferences = JSON.parse(fs.readFileSync(preferencesPath, 'utf8'));
    const extensionSettings = preferences?.extensions?.settings;
    if (!extensionSettings || typeof extensionSettings !== 'object') {
        return null;
    }

    const normalizedRepoRoot = fs.realpathSync(repoRoot);
    for (const [extensionId, settings] of Object.entries(extensionSettings)) {
        if (!settings || typeof settings !== 'object' || !settings.path) {
            continue;
        }

        try {
            if (fs.realpathSync(settings.path) === normalizedRepoRoot) {
                return extensionId;
            }
        } catch (error) {
            // Ignore stale paths while polling for the extension registration.
        }
    }

    return null;
}

function isExtensionWorker(worker) {
    return typeof worker.url() === 'string' && worker.url().startsWith('chrome-extension://');
}

// The MV3 service worker URL carries the extension id; Preferences is only a bounded fallback.
async function waitForExtensionId(context, userDataDir, repoRoot, timeoutMs = 15000) {
    const cachedId = extensionIdByContext.get(context);
    if (cachedId) {
        return cachedId;
    }

    const startTime = Date.now();
    let worker = context.serviceWorkers().find(isExtensionWorker);
    if (!worker) {
        worker = await context.waitForEvent('serviceworker', {
            predicate: isExtensionWorker,
            timeout: timeoutMs
        }).catch(() => null);
    }

    let extensionId = worker ? new URL(worker.url()).host : null;
    while (!extensionId && Date.now() - startTime < timeoutMs) {
        extensionId = readExtensionIdFromPreferences(userDataDir, repoRoot);
        if (!extensionId) {
            await new Promise((resolve) => setTimeout(resolve, 200));
        }
    }

    if (!extensionId) {
        throw new Error('Timed out waiting for the unpacked extension to register.');
    }
    extensionIdByContext.set(context, extensionId);
    return extensionId;
}

async function logBrowserVersionOnce(context) {
    if (browserVersionLogged) {
        return;
    }
    browserVersionLogged = true;

    const page = context.pages()[0] || await context.newPage();
    const session = await context.newCDPSession(page);
    try {
        const { product } = await session.send('Browser.getVersion');
        console.log(`[smoke] browser: ${product}${process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? ' (PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH override)' : ' (Playwright bundled Chromium)'}`);
    } finally {
        await session.detach().catch(() => {});
    }
}

async function launchExtensionContext(repoRoot) {
    const userDataDir = createUserDataDir();
    ensurePlaywrightArtifactDirs();
    const headless = shouldRunHeadless();
    const executablePath = resolveChromiumExecutablePath();
    const launchOptions = {
        headless,
        ignoreDefaultArgs: ['--disable-extensions'],
        args: [
            `--disable-extensions-except=${repoRoot}`,
            `--load-extension=${repoRoot}`
        ]
    };

    if (executablePath) {
        launchOptions.executablePath = executablePath;
    } else {
        launchOptions.channel = 'chromium';
    }

    const context = await chromium.launchPersistentContext(userDataDir, launchOptions);

    try {
        await logBrowserVersionOnce(context);
        const extensionId = await waitForExtensionId(context, userDataDir, repoRoot);
        return { context, userDataDir, extensionId };
    } catch (error) {
        await closeExtensionContext({ context, userDataDir });
        throw error;
    }
}

async function closeExtensionContext(env) {
    if (!env) {
        return;
    }

    if (env.context) {
        await env.context.close();
    }

    if (env.userDataDir) {
        fs.rmSync(env.userDataDir, { recursive: true, force: true });
    }
}

async function openExtensionPage(context, extensionId, pagePath) {
    const page = await context.newPage();
    const normalizedPath = String(pagePath || '').replace(/^\/+/, '');
    await page.goto(`chrome-extension://${extensionId}/${normalizedPath}`);
    return page;
}

module.exports = {
    closeExtensionContext,
    launchExtensionContext,
    openExtensionPage,
    waitForExtensionId
};
