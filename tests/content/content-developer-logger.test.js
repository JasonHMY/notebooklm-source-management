const createContentDeveloperLogger = require(
    '../../src/content/content-developer-logger.js'
);

function createRuntimeMock() {
    const storedLogs = new Map();
    const sendMessage = jest.fn((message, callback) => {
        if (message?.type === 'LOAD_DEVELOPER_LOGS') {
            callback?.({
                success: true,
                logs: storedLogs.get(message.key) || []
            });
            return;
        }
        if (message?.type === 'APPEND_DEVELOPER_LOG') {
            const logs = [
                ...(storedLogs.get(message.key) || []),
                message.entry
            ];
            storedLogs.set(message.key, logs);
            callback?.({ success: true, logs });
            return;
        }
        if (message?.type === 'CLEAR_DEVELOPER_LOGS') {
            storedLogs.set(message.key, []);
            callback?.({ success: true, logs: [] });
            return;
        }
        callback?.({ success: false, errorCode: 'unexpected_message' });
    });
    return {
        chromeApi: {
            runtime: {
                sendMessage,
                lastError: null
            }
        },
        sendMessage,
        storedLogs
    };
}

describe('content developer logger', () => {
    it('does not write developer logs while developer mode is disabled', () => {
        const { chromeApi, sendMessage } = createRuntimeMock();
        const logger = createContentDeveloperLogger({
            chrome: chromeApi,
            getProjectId: () => 'project-dev',
            isDeveloperModeEnabled: () => false
        });

        expect(logger.developerLog(
            'info',
            'ui',
            'button_clicked',
            { sourceKey: 'source-1' }
        )).toBe(false);

        expect(logger.getDeveloperLogs()).toEqual([]);
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('reads the injected mode dynamically and writes sanitized logs', () => {
        const { chromeApi, sendMessage } = createRuntimeMock();
        let developerModeEnabled = false;
        const logger = createContentDeveloperLogger({
            chrome: chromeApi,
            getProjectId: () => 'project-dev',
            isDeveloperModeEnabled: () => developerModeEnabled,
            now: () => '2026-05-15T00:00:00.000Z'
        });

        expect(logger.developerLog(
            'info',
            'ui',
            'disabled_attempt'
        )).toBe(false);
        developerModeEnabled = true;
        expect(logger.developerLog(
            'info',
            'source_action',
            'source_updated',
            {
                sourceKey: 'source-1',
                sourceTitle: 'Sensitive Source Title',
                groupTitle: 'Private Group',
                tagLabel: 'Secret Tag',
                importJson: '{"sourceTitle":"Sensitive Source Title"}',
                stableToken: 'token-value',
                fingerprint: 'fingerprint-value',
                reason: 'manual_test'
            }
        )).toBe(true);

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
                entry: expect.objectContaining({
                    event: 'source_updated'
                })
            }),
            expect.any(Function)
        );
    });

    it('caps logs by entry count and serialized size', () => {
        const { chromeApi } = createRuntimeMock();
        const logger = createContentDeveloperLogger({
            chrome: chromeApi,
            getProjectId: () => 'project-dev',
            isDeveloperModeEnabled: () => true
        });

        for (let index = 0; index < 620; index += 1) {
            logger.developerLog(
                'debug',
                'source_sync',
                'scan_finished',
                {
                    index,
                    reason: 'x'.repeat(2000)
                }
            );
        }

        const logs = logger.getDeveloperLogs();
        expect(logs.length).toBeLessThanOrEqual(500);
        expect(Buffer.byteLength(
            JSON.stringify(logs),
            'utf8'
        )).toBeLessThanOrEqual(512 * 1024);
        expect(logs[logs.length - 1]).toMatchObject({
            category: 'source_sync',
            event: 'scan_finished'
        });
    });

    it('builds a private-safe export with the current injected mode', () => {
        const { chromeApi } = createRuntimeMock();
        let developerModeEnabled = true;
        const logger = createContentDeveloperLogger({
            chrome: chromeApi,
            getProjectId: () => 'project-dev',
            getDiagnosticsInfo: () => ({
                notebookId: 'project-dev',
                developerLogCount: 1,
                latestDeveloperLogAt: '2026-05-15T00:00:00.000Z'
            }),
            isDeveloperModeEnabled: () => developerModeEnabled
        });

        logger.developerLog(
            'warn',
            'native_action',
            'delete_failed',
            {
                reason: 'confirm_dialog_missing',
                sourceTitle: 'Sensitive Source Title'
            }
        );
        developerModeEnabled = false;

        const exportPayload = JSON.parse(
            logger.getDeveloperLogExportText()
        );
        expect(exportPayload).toMatchObject({
            developerModeEnabled: false,
            diagnostics: {
                notebookId: 'project-dev',
                developerLogCount: 1
            },
            logs: [expect.objectContaining({
                category: 'native_action',
                event: 'delete_failed'
            })]
        });
        expect(JSON.stringify(exportPayload))
            .not.toContain('Sensitive Source Title');
    });

    it('loads and clears notebook-scoped developer logs independently', async () => {
        const { chromeApi, storedLogs, sendMessage } = createRuntimeMock();
        storedLogs.set('sourcesPlusDeveloperLogs_project-dev', [{
            id: 'saved-log',
            timestamp: '2026-05-15T00:00:00.000Z',
            level: 'info',
            category: 'ui',
            event: 'panel_opened',
            notebookId: 'project-dev',
            details: { reason: 'saved' }
        }]);
        const logger = createContentDeveloperLogger({
            chrome: chromeApi,
            getProjectId: () => 'project-dev',
            isDeveloperModeEnabled: () => true
        });

        await expect(logger.loadDeveloperLogs()).resolves.toEqual([
            expect.objectContaining({ id: 'saved-log' })
        ]);
        expect(logger.getLatestDeveloperLogAt())
            .toBe('2026-05-15T00:00:00.000Z');
        await expect(logger.clearDeveloperLogs()).resolves.toBe(true);
        expect(logger.getDeveloperLogs()).toEqual([]);
        expect(sendMessage).toHaveBeenCalledWith({
            type: 'CLEAR_DEVELOPER_LOGS',
            key: 'sourcesPlusDeveloperLogs_project-dev'
        }, expect.any(Function));
    });

    it('drops stale load and append responses after the active notebook changes', async () => {
        let projectId = 'project-a';
        const loadCallbacks = [];
        const appendCallbacks = [];
        const sendMessage = jest.fn((message, callback) => {
            if (message?.type === 'LOAD_DEVELOPER_LOGS') {
                loadCallbacks.push(callback);
                return;
            }
            if (message?.type === 'APPEND_DEVELOPER_LOG') {
                appendCallbacks.push(callback);
            }
        });
        const logger = createContentDeveloperLogger({
            chrome: {
                runtime: {
                    sendMessage,
                    lastError: null
                }
            },
            getProjectId: () => projectId,
            isDeveloperModeEnabled: () => true
        });

        const projectALoad = logger.loadDeveloperLogs();
        projectId = 'project-b';
        expect(logger.getDeveloperLogs()).toEqual([]);
        loadCallbacks[0]({
            success: true,
            logs: [{
                id: 'project-a-log',
                notebookId: 'project-a',
                event: 'loaded_from_a'
            }]
        });
        await expect(projectALoad).resolves.toEqual([]);
        expect(logger.getDeveloperLogs()).toEqual([]);

        logger.developerLog('info', 'ui', 'written_in_b');
        projectId = 'project-c';
        logger.developerLog('info', 'ui', 'written_in_c');
        appendCallbacks[1]({
            success: true,
            logs: [{
                id: 'project-c-log',
                notebookId: 'project-c',
                event: 'written_in_c'
            }]
        });
        appendCallbacks[0]({
            success: true,
            logs: [{
                id: 'project-b-log',
                notebookId: 'project-b',
                event: 'written_in_b'
            }]
        });
        await Promise.resolve();

        expect(logger.getDeveloperLogs()).toEqual([
            expect.objectContaining({
                notebookId: 'project-c',
                event: 'written_in_c'
            })
        ]);
    });

    it('keeps newer same-notebook log mutations when older responses arrive late', async () => {
        const loadCallbacks = [];
        const appendCallbacks = [];
        const sendMessage = jest.fn((message, callback) => {
            if (message?.type === 'LOAD_DEVELOPER_LOGS') {
                loadCallbacks.push(callback);
                return;
            }
            if (message?.type === 'APPEND_DEVELOPER_LOG') {
                appendCallbacks.push(callback);
            }
        });
        const logger = createContentDeveloperLogger({
            chrome: {
                runtime: {
                    sendMessage,
                    lastError: null
                }
            },
            getProjectId: () => 'project-dev',
            isDeveloperModeEnabled: () => true
        });

        const pendingLoad = logger.loadDeveloperLogs();
        logger.developerLog('info', 'ui', 'new_event');
        appendCallbacks[0]({
            success: true,
            logs: [{
                id: 'new-log',
                notebookId: 'project-dev',
                event: 'new_event'
            }]
        });
        await Promise.resolve();
        loadCallbacks[0]({
            success: true,
            logs: [{
                id: 'old-log',
                notebookId: 'project-dev',
                event: 'old_event'
            }]
        });
        await pendingLoad;

        expect(logger.getDeveloperLogs()).toEqual([
            expect.objectContaining({ event: 'new_event' })
        ]);

        logger.developerLog('info', 'ui', 'first_append');
        logger.developerLog('info', 'ui', 'second_append');
        appendCallbacks[2]({
            success: true,
            logs: [
                {
                    id: 'first-log',
                    notebookId: 'project-dev',
                    event: 'first_append'
                },
                {
                    id: 'second-log',
                    notebookId: 'project-dev',
                    event: 'second_append'
                }
            ]
        });
        appendCallbacks[1]({
            success: true,
            logs: [{
                id: 'first-log',
                notebookId: 'project-dev',
                event: 'first_append'
            }]
        });
        await Promise.resolve();

        expect(logger.getDeveloperLogs().map((entry) => entry.event))
            .toEqual(['first_append', 'second_append']);
    });

    it('does not expose preference state or send preference messages', () => {
        const { chromeApi, sendMessage } = createRuntimeMock();
        const logger = createContentDeveloperLogger({
            chrome: chromeApi,
            getProjectId: () => 'project-dev',
            isDeveloperModeEnabled: () => true
        });

        expect(Object.keys(logger).sort()).toEqual([
            '_sanitizeDetailsForTest',
            '_trimLogsForTest',
            'clearDeveloperLogs',
            'developerLog',
            'getDeveloperLogExportText',
            'getDeveloperLogs',
            'getLatestDeveloperLogAt',
            'loadDeveloperLogs'
        ]);

        logger.developerLog('info', 'ui', 'boundary_check');

        const messageTypes = sendMessage.mock.calls
            .map(([message]) => message?.type);
        expect(messageTypes).not.toContain('LOAD_PREFERENCES');
        expect(messageTypes).not.toContain('SAVE_PREFERENCES');
    });
});
