const createContentDeveloperLogger = require('../../src/content/content-developer-logger.js');

function createRuntimeMock() {
    const storedLogs = new Map();
    const sendMessage = jest.fn((message, cb) => {
        if (message?.type === 'LOAD_PREFERENCES') {
            cb?.({ success: true, preferences: { developerModeEnabled: false } });
            return;
        }
        if (message?.type === 'SAVE_PREFERENCES') {
            cb?.({ success: true, preferences: message.preferences });
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
        storedLogs
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
});
