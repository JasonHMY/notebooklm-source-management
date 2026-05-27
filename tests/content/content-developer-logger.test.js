const createContentDeveloperLogger = require('../../src/content/content-developer-logger.js');

function createRuntimeMock(options = {}) {
    const storedLogs = new Map();
    let preferences = {
        developerModeEnabled: false,
        welcomeOnboardingSeenVersion: 0,
        whatsNewSeenVersion: '',
        historyRetentionLimit: 20,
        languageOverride: 'auto',
        commandShortcuts: {},
        visibleQuickViewKinds: ['all', 'ungrouped', 'disabled', 'tag', 'recent', 'issues']
    };
    const savePreferencesResponse = options.savePreferencesResponse || null;
    const usageState = options.usageState || {
        hasExistingPluginData: false,
        hasStoredPreferences: false
    };
    const sendMessage = jest.fn((message, cb) => {
        if (message?.type === 'LOAD_PREFERENCES') {
            cb?.({ success: true, preferences, usageState });
            return;
        }
        if (message?.type === 'SAVE_PREFERENCES') {
            if (savePreferencesResponse) {
                cb?.(savePreferencesResponse);
                return;
            }
            preferences = Object.assign({}, preferences, message.preferences || {});
            cb?.({ success: true, preferences });
            return;
        }
        if (message?.type === 'LOAD_DEVELOPER_LOGS') {
            cb?.({ success: true, logs: storedLogs.get(message.key) || [] });
            return;
        }
        if (message?.type === 'APPEND_DEVELOPER_LOG') {
            const logs = [...(storedLogs.get(message.key) || []), message.entry];
            storedLogs.set(message.key, logs);
            cb?.({ success: true, logs });
            return;
        }
        if (message?.type === 'CLEAR_DEVELOPER_LOGS') {
            storedLogs.set(message.key, []);
            cb?.({ success: true, logs: [] });
            return;
        }
        cb?.({ success: false, errorCode: 'unexpected_message' });
    });
    return {
        chromeApi: { runtime: { sendMessage, lastError: null } },
        sendMessage,
        storedLogs,
        getPreferences: () => preferences
    };
}

describe('content developer logger', () => {
    it('does not write developer logs while developer mode is disabled', () => {
        const { chromeApi, sendMessage } = createRuntimeMock();
        const logger = createContentDeveloperLogger({
            chrome: chromeApi,
            getProjectId: () => 'project-dev'
        });

        expect(logger.developerLog('info', 'ui', 'button_clicked', { sourceKey: 'source-1' })).toBe(false);

        expect(logger.getDeveloperLogs()).toEqual([]);
        expect(sendMessage).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: 'APPEND_DEVELOPER_LOG' }),
            expect.any(Function)
        );
    });

    it('writes structured sanitized logs when developer mode is enabled', async () => {
        const { chromeApi, sendMessage } = createRuntimeMock();
        const logger = createContentDeveloperLogger({
            chrome: chromeApi,
            getProjectId: () => 'project-dev',
            now: () => '2026-05-15T00:00:00.000Z'
        });

        await logger.setDeveloperModeEnabled(true);
        const result = logger.developerLog('info', 'source_action', 'source_updated', {
            sourceKey: 'source-1',
            sourceTitle: 'Sensitive Source Title',
            groupTitle: 'Private Group',
            tagLabel: 'Secret Tag',
            importJson: '{"sourceTitle":"Sensitive Source Title"}',
            stableToken: 'token-value',
            fingerprint: 'fingerprint-value',
            reason: 'manual_test'
        });

        expect(result).toBe(true);
        const [entry] = logger.getDeveloperLogs();
        expect(entry).toMatchObject({
            id: expect.any(String),
            timestamp: '2026-05-15T00:00:00.000Z',
            level: 'info',
            category: 'source_action',
            event: 'source_updated',
            notebookId: 'project-dev',
            details: expect.objectContaining({
                sourceKey: 'source-1',
                stableTokenHash: expect.any(String),
                fingerprintHash: expect.any(String),
                reason: 'manual_test'
            })
        });
        const serialized = JSON.stringify(logger.getDeveloperLogs());
        expect(serialized).not.toContain('Sensitive Source Title');
        expect(serialized).not.toContain('Private Group');
        expect(serialized).not.toContain('Secret Tag');
        expect(serialized).not.toContain('token-value');
        expect(serialized).not.toContain('fingerprint-value');
        expect(sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'APPEND_DEVELOPER_LOG',
                key: 'sourcesPlusDeveloperLogs_project-dev',
                entry: expect.objectContaining({ event: 'source_updated' })
            }),
            expect.any(Function)
        );
    });

    it('caps logs by entry count and serialized size', async () => {
        const { chromeApi } = createRuntimeMock();
        const logger = createContentDeveloperLogger({
            chrome: chromeApi,
            getProjectId: () => 'project-dev'
        });

        await logger.setDeveloperModeEnabled(true);
        for (let index = 0; index < 620; index += 1) {
            logger.developerLog('debug', 'source_sync', 'scan_finished', {
                index,
                reason: 'x'.repeat(2000)
            });
        }

        const logs = logger.getDeveloperLogs();
        expect(logs.length).toBeLessThanOrEqual(500);
        expect(Buffer.byteLength(JSON.stringify(logs), 'utf8')).toBeLessThanOrEqual(512 * 1024);
        expect(logs[logs.length - 1]).toMatchObject({
            category: 'source_sync',
            event: 'scan_finished'
        });
    });

    it('builds a developer log export bundle without exposing log internals through diagnostics', async () => {
        const { chromeApi } = createRuntimeMock();
        const logger = createContentDeveloperLogger({
            chrome: chromeApi,
            getProjectId: () => 'project-dev',
            getDiagnosticsInfo: () => ({
                notebookId: 'project-dev',
                developerLogCount: 1,
                latestDeveloperLogAt: '2026-05-15T00:00:00.000Z'
            })
        });

        await logger.setDeveloperModeEnabled(true);
        logger.developerLog('warn', 'native_action', 'delete_failed', {
            reason: 'confirm_dialog_missing',
            sourceTitle: 'Sensitive Source Title'
        });

        const exportPayload = JSON.parse(logger.getDeveloperLogExportText());
        expect(exportPayload).toMatchObject({
            developerModeEnabled: true,
            diagnostics: {
                notebookId: 'project-dev',
                developerLogCount: 1
            },
            logs: [expect.objectContaining({
                category: 'native_action',
                event: 'delete_failed'
            })]
        });
        expect(JSON.stringify(exportPayload)).not.toContain('Sensitive Source Title');
    });

    it('loads and saves the welcome onboarding version through global preferences', async () => {
        const { chromeApi, sendMessage } = createRuntimeMock();
        const logger = createContentDeveloperLogger({
            chrome: chromeApi,
            getProjectId: () => 'project-dev'
        });

        await logger.loadDeveloperPreferences();
        expect(logger.getWelcomeOnboardingSeenVersion()).toBe(0);

        await logger.setWelcomeOnboardingSeenVersion(1);

        expect(logger.getWelcomeOnboardingSeenVersion()).toBe(1);
        expect(logger.getDeveloperModeEnabled()).toBe(false);
        expect(sendMessage).toHaveBeenCalledWith(
            {
                type: 'SAVE_PREFERENCES',
                preferences: { welcomeOnboardingSeenVersion: 1 }
            },
            expect.any(Function)
        );
    });

    it('loads and saves whats new, history retention, and language preferences', async () => {
        const { chromeApi, getPreferences } = createRuntimeMock();
        const logger = createContentDeveloperLogger({
            chrome: chromeApi,
            getProjectId: () => 'project-dev'
        });

        await logger.setWhatsNewSeenVersion('2.7.4');
        await logger.setHistoryRetentionLimit(50);
        await logger.setLanguageOverride('zh_CN');

        expect(logger.getWhatsNewSeenVersion()).toBe('2.7.4');
        expect(logger.getHistoryRetentionLimit()).toBe(50);
        expect(logger.getLanguageOverride()).toBe('zh_CN');
        expect(getPreferences()).toMatchObject({
            whatsNewSeenVersion: '2.7.4',
            historyRetentionLimit: 50,
            languageOverride: 'zh_CN'
        });
    });

    it('loads preference usage state from the background response', async () => {
        const { chromeApi } = createRuntimeMock({
            usageState: {
                hasExistingPluginData: true,
                hasStoredPreferences: false
            }
        });
        const logger = createContentDeveloperLogger({
            chrome: chromeApi,
            getProjectId: () => 'project-dev'
        });

        await logger.loadDeveloperPreferences();

        expect(logger.getPreferenceUsageState()).toEqual({
            hasExistingPluginData: true,
            hasStoredPreferences: false
        });
    });

    it('loads, saves, and clears custom command shortcuts', async () => {
        const { chromeApi, getPreferences } = createRuntimeMock();
        const logger = createContentDeveloperLogger({
            chrome: chromeApi,
            getProjectId: () => 'project-dev'
        });

        await logger.loadDeveloperPreferences();
        expect(logger.getCommandShortcuts()).toEqual({});

        await logger.setCommandShortcut('quick-view-recent', 'Meta+Shift+R');
        expect(logger.getCommandShortcut('quick-view-recent')).toBe('Meta+Shift+R');
        expect(getPreferences().commandShortcuts).toEqual({
            'quick-view-recent': 'Meta+Shift+R'
        });

        await logger.setCommandShortcut('quick-view-recent', '');
        expect(logger.getCommandShortcut('quick-view-recent')).toBe('');
        expect(logger.getCommandShortcuts()).toEqual({});
    });

    it('loads and saves visible quick view button preferences', async () => {
        const { chromeApi, getPreferences } = createRuntimeMock();
        const logger = createContentDeveloperLogger({
            chrome: chromeApi,
            getProjectId: () => 'project-dev'
        });

        await logger.loadDeveloperPreferences();
        expect(logger.getVisibleQuickViewKinds()).toEqual([
            'all',
            'ungrouped',
            'disabled',
            'tag',
            'recent',
            'issues'
        ]);

        await logger.setVisibleQuickViewKinds(['issues', 'bad-kind', 'all', 'issues']);

        expect(logger.getVisibleQuickViewKinds()).toEqual(['all', 'issues']);
        expect(getPreferences().visibleQuickViewKinds).toEqual(['all', 'issues']);

        await logger.setVisibleQuickViewKinds([]);
        expect(logger.getVisibleQuickViewKinds()).toEqual([]);
    });

    it('keeps the previous preference value when saving preferences fails', async () => {
        const { chromeApi } = createRuntimeMock({
            savePreferencesResponse: { success: false, errorCode: 'runtime_failure' }
        });
        const logger = createContentDeveloperLogger({
            chrome: chromeApi,
            getProjectId: () => 'project-dev'
        });

        await expect(logger.setLanguageOverride('zh_CN')).rejects.toThrow(/runtime_failure/);

        expect(logger.getLanguageOverride()).toBe('auto');
    });

    describe('appearance preferences', () => {
        it('defaults hoverSpotlightEnabled to true before preferences are loaded', () => {
            const { chromeApi } = createRuntimeMock();
            const logger = createContentDeveloperLogger({
                chrome: chromeApi,
                getProjectId: () => 'project-dev'
            });
            expect(logger.getHoverSpotlightEnabled()).toBe(true);
        });

        it('loadDeveloperPreferences applies appearance.hoverSpotlightEnabled from background response', async () => {
            // Mock LOAD_PREFERENCES returning appearance.hoverSpotlightEnabled: false via a custom sendMessage
            const sendMessage = jest.fn((message, cb) => {
                if (message?.type === 'LOAD_PREFERENCES') {
                    cb?.({
                        success: true,
                        preferences: { appearance: { hoverSpotlightEnabled: false } },
                        usageState: { hasExistingPluginData: false, hasStoredPreferences: false }
                    });
                    return;
                }
                cb?.({ success: false, errorCode: 'unexpected_message' });
            });
            const logger = createContentDeveloperLogger({
                chrome: { runtime: { sendMessage, lastError: null } },
                getProjectId: () => 'project-dev'
            });
            await logger.loadDeveloperPreferences();
            expect(logger.getHoverSpotlightEnabled()).toBe(false);
        });

        it('setHoverSpotlightEnabled optimistically updates and persists via SAVE_PREFERENCES', async () => {
            const sent = [];
            const sendMessage = jest.fn((message, cb) => {
                sent.push(message);
                if (message?.type === 'SAVE_PREFERENCES') {
                    cb?.({ success: true, preferences: { appearance: { hoverSpotlightEnabled: false } } });
                    return;
                }
                cb?.({ success: false, errorCode: 'unexpected_message' });
            });
            const logger = createContentDeveloperLogger({
                chrome: { runtime: { sendMessage, lastError: null } },
                getProjectId: () => 'project-dev'
            });
            const result = await logger.setHoverSpotlightEnabled(false);
            expect(result).toBe(false);
            expect(logger.getHoverSpotlightEnabled()).toBe(false);
            const saveMessage = sent.find((m) => m?.type === 'SAVE_PREFERENCES');
            expect(saveMessage?.preferences?.appearance?.hoverSpotlightEnabled).toBe(false);
        });

        it('setHoverSpotlightEnabled rolls back optimistic update when save fails', async () => {
            const { chromeApi } = createRuntimeMock({
                savePreferencesResponse: { success: false, errorCode: 'runtime_failure' }
            });
            const logger = createContentDeveloperLogger({
                chrome: chromeApi,
                getProjectId: () => 'project-dev'
            });
            await expect(logger.setHoverSpotlightEnabled(false)).rejects.toThrow();
            expect(logger.getHoverSpotlightEnabled()).toBe(true);
        });
    });
});
