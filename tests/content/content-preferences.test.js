require('../../src/utils/preference-normalizers.js');
const createContentPreferences = require('../../src/content/content-preferences.js');

const DEFAULT_QUICK_VIEWS = [
    'all',
    'ungrouped',
    'disabled',
    'tag',
    'recent',
    'issues'
];

function createCompletePreferences(overrides = {}) {
    return {
        developerModeEnabled: false,
        welcomeOnboardingSeenVersion: 0,
        whatsNewSeenVersion: '',
        historyRetentionLimit: 20,
        languageOverride: 'auto',
        dragMode: 'classic',
        commandShortcuts: {},
        visibleQuickViewKinds: [...DEFAULT_QUICK_VIEWS],
        appearance: { hoverSpotlightEnabled: true },
        ...overrides
    };
}

function createRuntimeMock({
    initialPreferences = createCompletePreferences(),
    usageState = {
        hasExistingPluginData: false,
        hasStoredPreferences: false
    },
    loadResponse,
    saveResponses = []
} = {}) {
    let preferences = createCompletePreferences(initialPreferences);
    let saveIndex = 0;
    const sendMessage = jest.fn((message, callback) => {
        if (message?.type === 'LOAD_PREFERENCES') {
            callback?.(loadResponse || {
                success: true,
                preferences,
                usageState
            });
            return;
        }
        if (message?.type === 'SAVE_PREFERENCES') {
            const configuredResponse = saveResponses[saveIndex];
            saveIndex += 1;
            if (configuredResponse) {
                callback?.(configuredResponse);
                return;
            }
            const patch = message.preferences || {};
            preferences = {
                ...preferences,
                ...patch,
                commandShortcuts: patch.commandShortcuts
                    ? globalThis.NSM_PREFERENCE_NORMALIZERS.normalizeCommandShortcuts({
                        ...preferences.commandShortcuts,
                        ...patch.commandShortcuts
                    })
                    : preferences.commandShortcuts,
                appearance: patch.appearance
                    ? {
                        ...preferences.appearance,
                        ...patch.appearance
                    }
                    : preferences.appearance
            };
            callback?.({ success: true, preferences });
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
        getPreferences: () => preferences
    };
}

describe('content preferences', () => {
    it('exposes safe normalized defaults before preferences are loaded', () => {
        const preferences = createContentPreferences();

        expect(preferences.getPreferencesLoadStatus()).toBe('idle');
        expect(preferences.getDeveloperModeEnabled()).toBe(false);
        expect(preferences.getWelcomeOnboardingSeenVersion()).toBe(0);
        expect(preferences.getWhatsNewSeenVersion()).toBe('');
        expect(preferences.getPreferenceUsageState()).toEqual({
            hasExistingPluginData: false,
            hasStoredPreferences: false
        });
        expect(preferences.getHistoryRetentionLimit()).toBe(20);
        expect(preferences.getLanguageOverride()).toBe('auto');
        expect(preferences.getCommandShortcuts()).toEqual({});
        expect(preferences.getVisibleQuickViewKinds()).toEqual(DEFAULT_QUICK_VIEWS);
        expect(preferences.getHoverSpotlightEnabled()).toBe(true);
        expect(preferences.getDragMode()).toBe('classic');
    });

    it('loads and normalizes the complete preference state without loading logs', async () => {
        const { chromeApi, sendMessage } = createRuntimeMock({
            initialPreferences: createCompletePreferences({
                developerModeEnabled: true,
                welcomeOnboardingSeenVersion: 4.8,
                whatsNewSeenVersion: '2.7.4',
                historyRetentionLimit: 999,
                languageOverride: 'zh_CN',
                dragMode: 'reflow',
                commandShortcuts: {
                    'quick-view-recent': 'Meta+Shift+R',
                    invalid: 'Bad'
                },
                visibleQuickViewKinds: ['issues', 'bad-kind', 'all', 'issues'],
                appearance: { hoverSpotlightEnabled: false }
            }),
            usageState: {
                hasExistingPluginData: true,
                hasStoredPreferences: true
            }
        });
        const preferences = createContentPreferences({ chrome: chromeApi });

        await expect(preferences.loadDeveloperPreferences()).resolves.toBe(true);

        expect(preferences.getPreferencesLoadStatus()).toBe('loaded');
        expect(preferences.getWelcomeOnboardingSeenVersion()).toBe(4);
        expect(preferences.getWhatsNewSeenVersion()).toBe('2.7.4');
        expect(preferences.getHistoryRetentionLimit()).toBe(20);
        expect(preferences.getLanguageOverride()).toBe('zh_CN');
        expect(preferences.getDragMode()).toBe('reflow');
        expect(preferences.getCommandShortcuts()).toEqual({
            'quick-view-recent': 'Meta+Shift+R'
        });
        expect(preferences.getVisibleQuickViewKinds()).toEqual(['all', 'issues']);
        expect(preferences.getHoverSpotlightEnabled()).toBe(false);
        expect(preferences.getPreferenceUsageState()).toEqual({
            hasExistingPluginData: true,
            hasStoredPreferences: true
        });
        expect(sendMessage).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: 'LOAD_DEVELOPER_LOGS' }),
            expect.any(Function)
        );
    });

    it('deduplicates concurrent ensure calls through one in-flight load promise', async () => {
        let settleLoad;
        const sendMessage = jest.fn((message, callback) => {
            if (message?.type === 'LOAD_PREFERENCES') {
                settleLoad = callback;
            }
        });
        const preferences = createContentPreferences({
            chrome: { runtime: { sendMessage, lastError: null } }
        });

        const firstLoad = preferences.ensureDeveloperPreferencesLoaded();
        const secondLoad = preferences.ensureDeveloperPreferencesLoaded();

        expect(firstLoad).toBe(secondLoad);
        expect(preferences.getPreferencesLoadStatus()).toBe('loading');
        expect(sendMessage).toHaveBeenCalledTimes(1);

        settleLoad({
            success: true,
            preferences: createCompletePreferences({ developerModeEnabled: true })
        });

        await expect(firstLoad).resolves.toBe(true);
        expect(preferences.getPreferencesLoadStatus()).toBe('loaded');
        expect(preferences.ensureDeveloperPreferencesLoaded()).toBe(firstLoad);
        expect(sendMessage).toHaveBeenCalledTimes(1);
    });

    it('moves through idle, loading, and failed states when preference loading fails', async () => {
        let settleLoad;
        const sendMessage = jest.fn((message, callback) => {
            if (message?.type === 'LOAD_PREFERENCES') settleLoad = callback;
        });
        const preferences = createContentPreferences({
            chrome: { runtime: { sendMessage, lastError: null } }
        });

        expect(preferences.getPreferencesLoadStatus()).toBe('idle');
        const pendingLoad = preferences.loadDeveloperPreferences();
        expect(preferences.getPreferencesLoadStatus()).toBe('loading');

        settleLoad({ success: false, errorCode: 'runtime_failure' });
        await expect(pendingLoad).resolves.toBe(false);

        expect(preferences.getPreferencesLoadStatus()).toBe('failed');
        expect(preferences.getDragMode()).toBe('classic');
    });

    it('rejects non-strict load success responses', async () => {
        const { chromeApi } = createRuntimeMock({
            loadResponse: {
                success: 'true',
                preferences: createCompletePreferences({
                    languageOverride: 'es',
                    dragMode: 'reflow'
                })
            }
        });
        const preferences = createContentPreferences({ chrome: chromeApi });

        await expect(preferences.loadDeveloperPreferences())
            .resolves.toBe(false);
        expect(preferences.getPreferencesLoadStatus()).toBe('failed');
        expect(preferences.getLanguageOverride()).toBe('auto');
        expect(preferences.getDragMode()).toBe('classic');
    });

    it('rejects non-strict save success responses and rolls back optimistically', async () => {
        const { chromeApi } = createRuntimeMock({
            saveResponses: [{}]
        });
        const preferences = createContentPreferences({ chrome: chromeApi });

        await expect(preferences.setDragMode('reflow'))
            .rejects.toThrow('runtime_failure');
        expect(preferences.getDragMode()).toBe('classic');
        expect(preferences.getPreferencesLoadStatus()).toBe('idle');
    });

    it('only recovers a failed load after a save returns the full normalized schema', async () => {
        const completePreferences = createCompletePreferences();
        const { chromeApi } = createRuntimeMock({
            loadResponse: { success: false, errorCode: 'runtime_failure' },
            saveResponses: [
                { success: true, preferences: { dragMode: 'classic' } },
                {
                    success: true,
                    preferences: createCompletePreferences({
                        historyRetentionLimit: 999,
                        visibleQuickViewKinds: ['issues', 'all']
                    })
                },
                { success: true, preferences: completePreferences }
            ]
        });
        const preferences = createContentPreferences({ chrome: chromeApi });

        await preferences.loadDeveloperPreferences();
        expect(preferences.getPreferencesLoadStatus()).toBe('failed');

        await preferences.setDragMode('classic');
        expect(preferences.getPreferencesLoadStatus()).toBe('failed');

        await preferences.setDragMode('classic');
        expect(preferences.getPreferencesLoadStatus()).toBe('failed');

        await preferences.setDragMode('classic');
        expect(preferences.getPreferencesLoadStatus()).toBe('loaded');
    });

    it('merges a partial successful save without resetting unrelated preferences', async () => {
        const { chromeApi } = createRuntimeMock({
            initialPreferences: createCompletePreferences({
                developerModeEnabled: true,
                welcomeOnboardingSeenVersion: 3,
                whatsNewSeenVersion: '2.7.4',
                historyRetentionLimit: 50,
                languageOverride: 'es',
                commandShortcuts: {
                    'quick-view-recent': 'Meta+Shift+R'
                },
                visibleQuickViewKinds: ['all', 'issues'],
                appearance: { hoverSpotlightEnabled: false }
            }),
            saveResponses: [{
                success: true,
                preferences: { dragMode: 'reflow' }
            }]
        });
        const preferences = createContentPreferences({ chrome: chromeApi });

        await preferences.loadDeveloperPreferences();
        await preferences.setDragMode('reflow');

        expect(preferences.getDeveloperModeEnabled()).toBe(true);
        expect(preferences.getWelcomeOnboardingSeenVersion()).toBe(3);
        expect(preferences.getWhatsNewSeenVersion()).toBe('2.7.4');
        expect(preferences.getHistoryRetentionLimit()).toBe(50);
        expect(preferences.getLanguageOverride()).toBe('es');
        expect(preferences.getCommandShortcuts()).toEqual({
            'quick-view-recent': 'Meta+Shift+R'
        });
        expect(preferences.getVisibleQuickViewKinds()).toEqual([
            'all',
            'issues'
        ]);
        expect(preferences.getHoverSpotlightEnabled()).toBe(false);
        expect(preferences.getDragMode()).toBe('reflow');
        expect(preferences.getPreferencesLoadStatus()).toBe('loaded');
    });

    it('does not let an older load overwrite any field from a newer complete save', async () => {
        let settleLoad;
        const sendMessage = jest.fn((message, callback) => {
            if (message?.type === 'LOAD_PREFERENCES') {
                settleLoad = callback;
                return;
            }
            if (message?.type === 'SAVE_PREFERENCES') {
                callback?.({
                    success: true,
                    preferences: createCompletePreferences({
                        languageOverride: 'es',
                        dragMode: 'classic'
                    })
                });
            }
        });
        const preferences = createContentPreferences({
            chrome: { runtime: { sendMessage, lastError: null } }
        });

        const pendingLoad = preferences.loadDeveloperPreferences();
        await preferences.setDragMode('classic');
        settleLoad({
            success: true,
            preferences: createCompletePreferences({
                languageOverride: 'auto',
                dragMode: 'reflow'
            })
        });
        await pendingLoad;

        expect(preferences.getLanguageOverride()).toBe('es');
        expect(preferences.getDragMode()).toBe('classic');
        expect(preferences.getPreferencesLoadStatus()).toBe('loaded');
    });

    it('lets a partial successful save supersede an older load without proving loaded', async () => {
        let settleLoad;
        const sendMessage = jest.fn((message, callback) => {
            if (message?.type === 'LOAD_PREFERENCES') {
                settleLoad = callback;
                return;
            }
            if (message?.type === 'SAVE_PREFERENCES') {
                callback?.({
                    success: true,
                    preferences: { dragMode: 'classic' }
                });
            }
        });
        const preferences = createContentPreferences({
            chrome: { runtime: { sendMessage, lastError: null } }
        });

        const pendingLoad = preferences.loadDeveloperPreferences();
        await preferences.setDragMode('classic');
        settleLoad({
            success: true,
            preferences: createCompletePreferences({
                developerModeEnabled: true,
                historyRetentionLimit: 50,
                languageOverride: 'es',
                dragMode: 'reflow',
                commandShortcuts: {
                    'quick-view-recent': 'Meta+Shift+R'
                },
                visibleQuickViewKinds: ['all', 'issues'],
                appearance: { hoverSpotlightEnabled: false }
            })
        });
        await pendingLoad;

        expect(preferences.getDragMode()).toBe('classic');
        expect(preferences.getDeveloperModeEnabled()).toBe(true);
        expect(preferences.getHistoryRetentionLimit()).toBe(50);
        expect(preferences.getLanguageOverride()).toBe('es');
        expect(preferences.getCommandShortcuts()).toEqual({
            'quick-view-recent': 'Meta+Shift+R'
        });
        expect(preferences.getVisibleQuickViewKinds())
            .toEqual(['all', 'issues']);
        expect(preferences.getHoverSpotlightEnabled()).toBe(false);
        expect(preferences.getPreferencesLoadStatus()).toBe('failed');
    });

    it('allows an older valid load to complete after a newer save fails', async () => {
        let settleLoad;
        const sendMessage = jest.fn((message, callback) => {
            if (message?.type === 'LOAD_PREFERENCES') {
                settleLoad = callback;
                return;
            }
            if (message?.type === 'SAVE_PREFERENCES') {
                callback?.({ success: false, errorCode: 'runtime_failure' });
            }
        });
        const preferences = createContentPreferences({
            chrome: { runtime: { sendMessage, lastError: null } }
        });

        const pendingLoad = preferences.loadDeveloperPreferences();
        await expect(preferences.setDragMode('classic')).rejects.toThrow('runtime_failure');
        settleLoad({
            success: true,
            preferences: createCompletePreferences({ dragMode: 'reflow' })
        });
        await pendingLoad;

        expect(preferences.getDragMode()).toBe('reflow');
        expect(preferences.getPreferencesLoadStatus()).toBe('loaded');
    });

    it('does not let an older failed save roll back a newer successful value', async () => {
        const saveCallbacks = [];
        const sendMessage = jest.fn((message, callback) => {
            if (message?.type === 'SAVE_PREFERENCES') {
                saveCallbacks.push(callback);
            }
        });
        const preferences = createContentPreferences({
            chrome: { runtime: { sendMessage, lastError: null } }
        });

        const olderSave = preferences.setLanguageOverride('es');
        const newerSave = preferences.setLanguageOverride('zh_CN');

        expect(preferences.getLanguageOverride()).toBe('zh_CN');
        saveCallbacks[1]({
            success: true,
            preferences: createCompletePreferences({
                languageOverride: 'zh_CN'
            })
        });
        await expect(newerSave).resolves.toBe('zh_CN');
        expect(preferences.getLanguageOverride()).toBe('zh_CN');

        saveCallbacks[0]({
            success: false,
            errorCode: 'runtime_failure'
        });
        await expect(olderSave).rejects.toThrow('runtime_failure');
        expect(preferences.getLanguageOverride()).toBe('zh_CN');
    });

    it('keeps a newer optimistic value over an older success and restores that success if the newer save fails', async () => {
        const saveCallbacks = [];
        const sendMessage = jest.fn((message, callback) => {
            if (message?.type === 'SAVE_PREFERENCES') {
                saveCallbacks.push(callback);
            }
        });
        const preferences = createContentPreferences({
            chrome: { runtime: { sendMessage, lastError: null } }
        });

        const olderSave = preferences.setLanguageOverride('es');
        const newerSave = preferences.setLanguageOverride('zh_CN');

        saveCallbacks[0]({
            success: true,
            preferences: createCompletePreferences({
                languageOverride: 'es'
            })
        });
        await olderSave;
        expect(preferences.getLanguageOverride()).toBe('zh_CN');

        saveCallbacks[1]({
            success: false,
            errorCode: 'runtime_failure'
        });
        await expect(newerSave).rejects.toThrow('runtime_failure');
        expect(preferences.getLanguageOverride()).toBe('es');
    });

    it('composes out-of-order successful saves for different fields without snapshots', async () => {
        const saveCallbacks = [];
        const sendMessage = jest.fn((message, callback) => {
            if (message?.type === 'SAVE_PREFERENCES') {
                saveCallbacks.push(callback);
            }
        });
        const preferences = createContentPreferences({
            chrome: { runtime: { sendMessage, lastError: null } }
        });

        const languageSave = preferences.setLanguageOverride('es');
        const dragSave = preferences.setDragMode('reflow');

        saveCallbacks[1]({ success: true });
        await expect(dragSave).resolves.toBe('reflow');
        expect(preferences.getLanguageOverride()).toBe('es');
        expect(preferences.getDragMode()).toBe('reflow');

        saveCallbacks[0]({ success: true });
        await expect(languageSave).resolves.toBe('es');
        expect(preferences.getLanguageOverride()).toBe('es');
        expect(preferences.getDragMode()).toBe('reflow');
    });

    it('composes out-of-order full snapshots by the fields each save changed', async () => {
        const saveCallbacks = [];
        const sendMessage = jest.fn((message, callback) => {
            if (message?.type === 'SAVE_PREFERENCES') {
                saveCallbacks.push(callback);
            }
        });
        const preferences = createContentPreferences({
            chrome: { runtime: { sendMessage, lastError: null } }
        });

        const languageSave = preferences.setLanguageOverride('es');
        const dragSave = preferences.setDragMode('reflow');

        saveCallbacks[1]({
            success: true,
            preferences: createCompletePreferences({
                languageOverride: 'auto',
                dragMode: 'reflow'
            })
        });
        await dragSave;
        expect(preferences.getLanguageOverride()).toBe('es');
        expect(preferences.getDragMode()).toBe('reflow');

        saveCallbacks[0]({
            success: true,
            preferences: createCompletePreferences({
                languageOverride: 'es',
                dragMode: 'classic'
            })
        });
        await languageSave;
        expect(preferences.getLanguageOverride()).toBe('es');
        expect(preferences.getDragMode()).toBe('reflow');
    });

    it('does not retain an older failed shortcut inside a newer partial success', async () => {
        const saveCallbacks = [];
        const sendMessage = jest.fn((message, callback) => {
            if (message?.type === 'SAVE_PREFERENCES') {
                saveCallbacks.push(callback);
            }
        });
        const preferences = createContentPreferences({
            chrome: { runtime: { sendMessage, lastError: null } }
        });

        const olderShortcut = preferences.setCommandShortcut(
            'quick-view-recent',
            'Meta+Shift+R'
        );
        const newerShortcut = preferences.setCommandShortcut(
            'quick-view-issues',
            'Meta+Shift+I'
        );

        saveCallbacks[1]({ success: true });
        await newerShortcut;
        expect(preferences.getCommandShortcuts()).toEqual({
            'quick-view-recent': 'Meta+Shift+R',
            'quick-view-issues': 'Meta+Shift+I'
        });

        saveCallbacks[0]({
            success: false,
            errorCode: 'runtime_failure'
        });
        await expect(olderShortcut).rejects.toThrow('runtime_failure');
        expect(preferences.getCommandShortcuts()).toEqual({
            'quick-view-issues': 'Meta+Shift+I'
        });
    });

    it('does not let an older canonical save prove a newer unnormalized state', async () => {
        const saveCallbacks = [];
        const sendMessage = jest.fn((message, callback) => {
            if (message?.type === 'LOAD_PREFERENCES') {
                callback?.({
                    success: false,
                    errorCode: 'runtime_failure'
                });
                return;
            }
            if (message?.type === 'SAVE_PREFERENCES') {
                saveCallbacks.push(callback);
            }
        });
        const preferences = createContentPreferences({
            chrome: { runtime: { sendMessage, lastError: null } }
        });

        await preferences.loadDeveloperPreferences();
        const olderSave = preferences.setLanguageOverride('es');
        const newerSave = preferences.setDragMode('reflow');

        saveCallbacks[1]({
            success: true,
            preferences: createCompletePreferences({
                historyRetentionLimit: 999,
                dragMode: 'reflow'
            })
        });
        await newerSave;
        expect(preferences.getPreferencesLoadStatus()).toBe('failed');

        saveCallbacks[0]({
            success: true,
            preferences: createCompletePreferences({
                languageOverride: 'es'
            })
        });
        await olderSave;
        expect(preferences.getPreferencesLoadStatus()).toBe('failed');
    });

    it('exposes an optimistic value before save settles and restores it on failure', async () => {
        let settleSave;
        const sendMessage = jest.fn((message, callback) => {
            if (message?.type === 'SAVE_PREFERENCES') {
                settleSave = callback;
            }
        });
        const preferences = createContentPreferences({
            chrome: { runtime: { sendMessage, lastError: null } }
        });

        const pendingSave = preferences.setLanguageOverride('zh_CN');

        expect(preferences.getLanguageOverride()).toBe('zh_CN');
        settleSave({ success: false, errorCode: 'runtime_failure' });
        await expect(pendingSave).rejects.toThrow('runtime_failure');
        expect(preferences.getLanguageOverride()).toBe('auto');
    });

    it('rolls back every optimistic scalar setter when saving fails', async () => {
        const scalarCases = [
            ['setDeveloperModeEnabled', 'getDeveloperModeEnabled', true, false],
            ['setWelcomeOnboardingSeenVersion', 'getWelcomeOnboardingSeenVersion', 3, 0],
            ['setWhatsNewSeenVersion', 'getWhatsNewSeenVersion', '2.7.4', ''],
            ['setHistoryRetentionLimit', 'getHistoryRetentionLimit', 50, 20],
            ['setLanguageOverride', 'getLanguageOverride', 'es', 'auto'],
            ['setHoverSpotlightEnabled', 'getHoverSpotlightEnabled', false, true],
            ['setDragMode', 'getDragMode', 'reflow', 'classic']
        ];

        for (const [setter, getter, nextValue, previousValue] of scalarCases) {
            const { chromeApi } = createRuntimeMock({
                saveResponses: [{ success: false, errorCode: 'runtime_failure' }]
            });
            const preferences = createContentPreferences({ chrome: chromeApi });

            await expect(preferences[setter](nextValue)).rejects.toThrow('runtime_failure');
            expect(preferences[getter]()).toBe(previousValue);
        }
    });

    it('persists onboarding versions together and rolls both back on failure', async () => {
        const { chromeApi, sendMessage } = createRuntimeMock();
        const preferences = createContentPreferences({ chrome: chromeApi });

        await expect(preferences.setOnboardingModalSeenVersions({
            welcomeOnboardingSeenVersion: 1,
            whatsNewSeenVersion: '2.7.4'
        })).resolves.toEqual({
            welcomeOnboardingSeenVersion: 1,
            whatsNewSeenVersion: '2.7.4'
        });
        expect(sendMessage).toHaveBeenCalledWith({
            type: 'SAVE_PREFERENCES',
            preferences: {
                welcomeOnboardingSeenVersion: 1,
                whatsNewSeenVersion: '2.7.4'
            }
        }, expect.any(Function));

        const failedRuntime = createRuntimeMock({
            saveResponses: [{ success: false, errorCode: 'runtime_failure' }]
        });
        const failedPreferences = createContentPreferences({
            chrome: failedRuntime.chromeApi
        });
        await expect(failedPreferences.setOnboardingModalSeenVersions({
            welcomeOnboardingSeenVersion: 1,
            whatsNewSeenVersion: '2.7.4'
        })).rejects.toThrow('runtime_failure');
        expect(failedPreferences.getWelcomeOnboardingSeenVersion()).toBe(0);
        expect(failedPreferences.getWhatsNewSeenVersion()).toBe('');
    });

    it('rolls back shortcut and quick-view collection changes when saving fails', async () => {
        const failedShortcutRuntime = createRuntimeMock({
            saveResponses: [{ success: false, errorCode: 'runtime_failure' }]
        });
        const shortcutPreferences = createContentPreferences({
            chrome: failedShortcutRuntime.chromeApi
        });

        await expect(shortcutPreferences.setCommandShortcut(
            'quick-view-recent',
            'Meta+Shift+R'
        )).rejects.toThrow('runtime_failure');
        expect(shortcutPreferences.getCommandShortcuts()).toEqual({});

        const failedQuickViewRuntime = createRuntimeMock({
            saveResponses: [{ success: false, errorCode: 'runtime_failure' }]
        });
        const quickViewPreferences = createContentPreferences({
            chrome: failedQuickViewRuntime.chromeApi
        });

        await expect(quickViewPreferences.setVisibleQuickViewKinds([
            'all',
            'issues'
        ])).rejects.toThrow('runtime_failure');
        expect(quickViewPreferences.getVisibleQuickViewKinds())
            .toEqual(DEFAULT_QUICK_VIEWS);
    });

    it('normalizes, de-duplicates, and clears command shortcuts', async () => {
        const { chromeApi } = createRuntimeMock();
        const preferences = createContentPreferences({ chrome: chromeApi });

        await preferences.setCommandShortcut('quick-view-recent', 'Meta+Shift+R');
        await preferences.setCommandShortcut('quick-view-issues', 'Meta+Shift+R');

        expect(preferences.getCommandShortcuts()).toEqual({
            'quick-view-issues': 'Meta+Shift+R'
        });

        await preferences.setCommandShortcut('quick-view-issues', '');
        expect(preferences.getCommandShortcut('quick-view-issues')).toBe('');
        expect(preferences.getCommandShortcuts()).toEqual({});
    });

    it('normalizes visible quick-view kinds and returns defensive copies', async () => {
        const { chromeApi } = createRuntimeMock();
        const preferences = createContentPreferences({ chrome: chromeApi });

        await preferences.setVisibleQuickViewKinds([
            'issues',
            'bad-kind',
            'all',
            'issues'
        ]);
        const visibleKinds = preferences.getVisibleQuickViewKinds();
        visibleKinds.push('recent');

        expect(preferences.getVisibleQuickViewKinds()).toEqual(['all', 'issues']);
    });

    it('returns defensive copies for usage and shortcut state', async () => {
        const { chromeApi } = createRuntimeMock({
            initialPreferences: createCompletePreferences({
                commandShortcuts: {
                    'quick-view-recent': 'Meta+Shift+R'
                }
            }),
            usageState: {
                hasExistingPluginData: true,
                hasStoredPreferences: false
            }
        });
        const preferences = createContentPreferences({ chrome: chromeApi });
        await preferences.loadDeveloperPreferences();

        const usage = preferences.getPreferenceUsageState();
        const shortcuts = preferences.getCommandShortcuts();
        usage.hasStoredPreferences = true;
        shortcuts['quick-view-recent'] = '';

        expect(preferences.getPreferenceUsageState()).toEqual({
            hasExistingPluginData: true,
            hasStoredPreferences: false
        });
        expect(preferences.getCommandShortcut('quick-view-recent')).toBe('Meta+Shift+R');
    });

    it('treats only strict false as disabling hover spotlight', async () => {
        const { chromeApi } = createRuntimeMock();
        const preferences = createContentPreferences({ chrome: chromeApi });

        await expect(preferences.setHoverSpotlightEnabled(false)).resolves.toBe(false);
        await expect(preferences.setHoverSpotlightEnabled(undefined)).resolves.toBe(true);
    });

    it('normalizes unknown drag modes to Classic', async () => {
        const { chromeApi } = createRuntimeMock();
        const preferences = createContentPreferences({ chrome: chromeApi });

        await expect(preferences.setDragMode('bogus')).resolves.toBe('classic');
        expect(preferences.getDragMode()).toBe('classic');
    });

    it('invalidates stale loads and saves across a test reset before accepting a fresh load', async () => {
        const loadCallbacks = [];
        const saveCallbacks = [];
        const sendMessage = jest.fn((message, callback) => {
            if (message?.type === 'LOAD_PREFERENCES') {
                loadCallbacks.push(callback);
                return;
            }
            if (message?.type === 'SAVE_PREFERENCES') {
                saveCallbacks.push(callback);
            }
        });
        const preferences = createContentPreferences({
            chrome: { runtime: { sendMessage, lastError: null } }
        });

        const staleLoad = preferences.ensureDeveloperPreferencesLoaded();
        const staleSave = preferences.setLanguageOverride('es');
        preferences._resetForTest();

        loadCallbacks[0]({
            success: true,
            preferences: createCompletePreferences({
                languageOverride: 'zh_CN'
            })
        });
        saveCallbacks[0]({
            success: true,
            preferences: createCompletePreferences({
                languageOverride: 'es'
            })
        });
        await staleLoad;
        await staleSave;

        expect(preferences.getLanguageOverride()).toBe('auto');
        expect(preferences.getPreferencesLoadStatus()).toBe('idle');

        const freshLoad = preferences.ensureDeveloperPreferencesLoaded();
        loadCallbacks[1]({
            success: true,
            preferences: createCompletePreferences({
                languageOverride: 'zh_CN'
            })
        });
        await freshLoad;

        expect(preferences.getLanguageOverride()).toBe('zh_CN');
        expect(preferences.getPreferencesLoadStatus()).toBe('loaded');
    });
});
