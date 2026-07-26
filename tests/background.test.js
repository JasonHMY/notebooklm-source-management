require('../src/utils/preference-normalizers.js');

describe('background.js message listener', () => {
    const DEFAULT_VISIBLE_QUICK_VIEW_KINDS = ['all', 'ungrouped', 'disabled', 'tag', 'recent', 'issues'];
    let listener;
    let mockSendResponse;

    beforeEach(() => {
        // Reset mocks before each test
        jest.clearAllMocks();

        // Mock global console.warn and console.error to keep test output clean
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});

        // Mock sendResponse
        mockSendResponse = jest.fn();

        // Mock chrome API
        global.chrome = {
            runtime: {
                id: 'abcdefghijklmnopabcdefghijklmnop',
                onMessage: {
                    addListener: jest.fn((cb) => {
                        listener = cb;
                    })
                },
                getManifest: jest.fn(() => ({})),
                lastError: undefined
            },
            tabs: {
                query: jest.fn((queryInfo, cb) => {
                    if (cb) cb([]);
                }),
                update: jest.fn((tabId, updateInfo, cb) => {
                    if (cb) cb({ id: tabId, url: 'https://notebooklm.google.com/notebook/123' });
                }),
                sendMessage: jest.fn((tabId, message, cb) => {
                    if (cb) cb();
                }),
                create: jest.fn((createProperties, cb) => {
                    if (cb) cb({ id: 99, url: createProperties.url });
                })
            },
            windows: {
                update: jest.fn((windowId, updateInfo, cb) => {
                    if (cb) cb();
                })
            },
            storage: {
                local: {
                    set: jest.fn((data, cb) => {
                        if (cb) cb();
                    }),
                    get: jest.fn((key, cb) => {
                        if (cb) cb({});
                    })
                }
            }
        };

        // Load the background script. This should trigger addListener.
        // We isolate the module so it evaluates the addListener each time.
        jest.isolateModules(() => {
            require('../src/background/index.js');
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
        delete global.chrome;
    });

    const validSender = {
        tab: {
            url: 'https://notebooklm.google.com/notebook/123'
        }
    };

    // A sender tab whose notebook id matches a given storage key's project segment, so the
    // per-notebook sender↔key binding allows the write.
    const senderForNotebook = (projectId) => ({
        tab: { url: `https://notebooklm.google.com/notebook/${projectId}` }
    });

    it('should log a warning and return early for an unauthorized sender', () => {
        const invalidSender = {
            tab: {
                url: 'https://example.com'
            }
        };

        listener({ type: 'SAVE_STATE' }, invalidSender, mockSendResponse);

        expect(console.warn).toHaveBeenCalledWith(
            'GeminiNotebook-Source-Management: Received message from unauthorized sender:',
            invalidSender
        );
        expect(global.chrome.storage.local.set).not.toHaveBeenCalled();
        expect(mockSendResponse).toHaveBeenCalledWith({
            success: false,
            errorCode: 'unauthorized_sender'
        });
    });

    it('rejects a SAVE_STATE whose key targets a different notebook than the sender tab', () => {
        // sender tab is notebook 123, but the key targets notebook 999 — a content script
        // must not write another notebook's storage.
        const request = {
            type: 'SAVE_STATE',
            key: 'sourcesPlusState_999',
            data: { groups: [], groupsById: {}, ungrouped: [], sourceStateById: {} }
        };

        listener(request, validSender, mockSendResponse);

        expect(global.chrome.storage.local.set).not.toHaveBeenCalled();
        expect(mockSendResponse).toHaveBeenCalledWith(expect.objectContaining({
            success: false,
            errorCode: 'unauthorized_sender'
        }));
    });

    it('should handle SAVE_STATE message successfully', () => {
        const request = {
            type: 'SAVE_STATE',
            key: 'sourcesPlusState_123',
            data: {
                groups: ['group1'],
                groupsById: { group1: { id: 'group1', children: [{ type: 'source', key: 'source_1' }] } },
                ungrouped: [],
                sourceStateById: { source_1: { enabled: true } }
            }
        };

        const result = listener(request, validSender, mockSendResponse);

        expect(global.chrome.storage.local.set).toHaveBeenCalledWith(
            expect.objectContaining({
                'sourcesPlusState_123': expect.objectContaining({
                    ...request.data,
                    _saveRevision: 1,
                    _savedAt: expect.any(String)
                }),
                'sourcesPlusState_123__backup': expect.objectContaining({
                    ...request.data,
                    _saveRevision: 1,
                    _savedAt: expect.any(String)
                }),
                'sourcesPlusHistory_123': expect.any(Array)
            }),
            expect.any(Function)
        );
        expect(mockSendResponse).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            saveRevision: 1,
            savedAt: expect.any(String),
            storageUsageBytes: expect.any(Number),
            storageQuotaBytes: expect.any(Number),
            storageUsageRatio: expect.any(Number),
            storageWarning: false,
            historyEntryCount: 1
        }));
        expect(result).toBe(true); // Should return true to keep channel open
    });

    it('should ignore stale SAVE_STATE revisions without overwriting newer stored state', () => {
        const newerState = {
            _saveRevision: 5,
            groups: ['newer'],
            groupsById: { newer: { id: 'newer', children: [] } },
            sourceStateById: {}
        };
        const request = {
            type: 'SAVE_STATE',
            key: 'sourcesPlusState_123',
            data: {
                _saveRevision: 4,
                groups: ['older'],
                groupsById: { older: { id: 'older', children: [] } },
                sourceStateById: {}
            }
        };

        global.chrome.storage.local.get.mockImplementationOnce((keys, cb) => {
            cb({ sourcesPlusState_123: newerState });
        });

        listener(request, validSender, mockSendResponse);

        expect(global.chrome.storage.local.set).not.toHaveBeenCalled();
        expect(mockSendResponse).toHaveBeenCalledWith({ success: true, stale: true, currentRevision: 5 });
    });

    it('should skip equivalent SAVE_STATE writes without assigning a new revision', () => {
        const currentState = {
            _saveRevision: 5,
            _savedAt: '2026-05-17T00:00:00.000Z',
            groups: ['same'],
            groupsById: { same: { id: 'same', children: [] } },
            sourceStateById: { source_1: { enabled: true } },
            sourceViewDisplayKind: 'list'
        };
        const request = {
            type: 'SAVE_STATE',
            key: 'sourcesPlusState_123',
            baseRevision: 5,
            data: {
                groups: ['same'],
                groupsById: { same: { id: 'same', children: [] } },
                sourceStateById: { source_1: { enabled: true } },
                sourceViewDisplayKind: 'list'
            }
        };

        global.chrome.storage.local.get.mockImplementationOnce((keys, cb) => {
            cb({ sourcesPlusState_123: currentState });
        });

        listener(request, validSender, mockSendResponse);

        expect(global.chrome.storage.local.set).not.toHaveBeenCalled();
        expect(mockSendResponse).toHaveBeenCalledWith({
            success: true,
            saveRevision: 5,
            savedAt: '2026-05-17T00:00:00.000Z',
            skipped: true,
            noChanges: true
        });
    });

    it('should reject explicit stale SAVE_STATE base revisions without overwriting newer state', () => {
        const newerState = {
            _saveRevision: 5,
            groups: ['newer'],
            groupsById: { newer: { id: 'newer', children: [] } },
            sourceStateById: {}
        };
        const request = {
            type: 'SAVE_STATE',
            key: 'sourcesPlusState_123',
            baseRevision: 4,
            data: {
                groups: ['older'],
                groupsById: { older: { id: 'older', children: [] } },
                sourceStateById: {}
            }
        };

        global.chrome.storage.local.get.mockImplementationOnce((keys, cb) => {
            cb({ sourcesPlusState_123: newerState });
        });

        listener(request, validSender, mockSendResponse);

        expect(global.chrome.storage.local.set).not.toHaveBeenCalled();
        expect(mockSendResponse).toHaveBeenCalledWith({
            success: false,
            errorCode: 'stale_revision',
            currentRevision: 5
        });
    });

    it('should allow legacy SAVE_STATE payloads without a revision', () => {
        const request = {
            type: 'SAVE_STATE',
            key: 'sourcesPlusState_123',
            data: {
                groups: ['legacy'],
                groupsById: { legacy: { id: 'legacy', children: [] } },
                sourceStateById: {}
            }
        };

        global.chrome.storage.local.get.mockImplementationOnce((keys, cb) => {
            cb({
                sourcesPlusState_123: {
                    _saveRevision: 5,
                    groups: ['newer'],
                    groupsById: { newer: { id: 'newer', children: [] } },
                    sourceStateById: {}
                }
            });
        });

        listener(request, validSender, mockSendResponse);

        expect(global.chrome.storage.local.set).toHaveBeenCalledWith(
            expect.objectContaining({
                sourcesPlusState_123: expect.objectContaining({
                    ...request.data,
                    _saveRevision: 6,
                    _savedAt: expect.any(String)
                }),
                sourcesPlusState_123__backup: expect.objectContaining({
                    ...request.data,
                    _saveRevision: 6,
                    _savedAt: expect.any(String)
                }),
                sourcesPlusHistory_123: expect.any(Array)
            }),
            expect.any(Function)
        );
        expect(mockSendResponse).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            saveRevision: 6,
            savedAt: expect.any(String)
        }));
    });

    it('should keep assigned revisions monotonic when explicit base is ahead of storage', () => {
        const request = {
            type: 'SAVE_STATE',
            key: 'sourcesPlusState_123',
            baseRevision: 5,
            data: {
                groups: ['ahead'],
                groupsById: { ahead: { id: 'ahead', children: [] } },
                sourceStateById: {}
            }
        };

        global.chrome.storage.local.get.mockImplementationOnce((keys, cb) => {
            cb({});
        });

        listener(request, validSender, mockSendResponse);

        expect(global.chrome.storage.local.set).toHaveBeenCalledWith(
            expect.objectContaining({
                sourcesPlusState_123: expect.objectContaining({
                    ...request.data,
                    _saveRevision: 6,
                    _savedAt: expect.any(String)
                }),
                sourcesPlusState_123__backup: expect.objectContaining({
                    ...request.data,
                    _saveRevision: 6,
                    _savedAt: expect.any(String)
                }),
                sourcesPlusHistory_123: expect.any(Array)
            }),
            expect.any(Function)
        );
        expect(mockSendResponse).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            saveRevision: 6,
            savedAt: expect.any(String)
        }));
    });

    it('should serialize SAVE_STATE writes for the same key before checking revisions', async () => {
        const firstRequest = {
            type: 'SAVE_STATE',
            key: 'sourcesPlusState_123',
            baseRevision: 0,
            data: {
                groups: ['first'],
                groupsById: { first: { id: 'first', children: [] } },
                sourceStateById: {}
            }
        };
        const secondRequest = {
            type: 'SAVE_STATE',
            key: 'sourcesPlusState_123',
            baseRevision: 1,
            data: {
                groups: ['second'],
                groupsById: { second: { id: 'second', children: [] } },
                sourceStateById: {}
            }
        };
        const pendingGets = [];
        const pendingSets = [];
        const firstResponse = jest.fn();
        const secondResponse = jest.fn();

        global.chrome.storage.local.get.mockImplementation((keys, cb) => {
            pendingGets.push(cb);
        });
        global.chrome.storage.local.set.mockImplementation((payload, cb) => {
            pendingSets.push({ payload, cb });
        });

        listener(firstRequest, validSender, firstResponse);
        listener(secondRequest, validSender, secondResponse);

        expect(pendingGets).toHaveLength(1);
        pendingGets[0]({});
        expect(pendingSets).toHaveLength(1);
        expect(pendingSets[0].payload.sourcesPlusState_123).toMatchObject({
            ...firstRequest.data,
            _saveRevision: 1,
            _savedAt: expect.any(String)
        });

        pendingSets[0].cb();
        expect(firstResponse).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            saveRevision: 1,
            savedAt: expect.any(String)
        }));
        await Promise.resolve();
        await Promise.resolve();

        expect(pendingGets).toHaveLength(2);
        pendingGets[1]({ sourcesPlusState_123: pendingSets[0].payload.sourcesPlusState_123 });
        expect(pendingSets).toHaveLength(2);
        expect(pendingSets[1].payload.sourcesPlusState_123).toMatchObject({
            ...secondRequest.data,
            _saveRevision: 2,
            _savedAt: expect.any(String)
        });

        pendingSets[1].cb();
        expect(secondResponse).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            saveRevision: 2,
            savedAt: expect.any(String)
        }));
    });

    it('waits for a pending SAVE_STATE before loading the same notebook state', async () => {
        const saveRequest = {
            type: 'SAVE_STATE',
            key: 'sourcesPlusState_123',
            baseRevision: 0,
            data: {
                groups: ['saved'],
                groupsById: { saved: { id: 'saved', children: [] } },
                sourceStateById: {}
            }
        };
        const loadRequest = { type: 'LOAD_STATE', key: 'sourcesPlusState_123' };
        const pendingGets = [];
        const pendingSets = [];
        const loadResponse = jest.fn();

        global.chrome.storage.local.get.mockImplementation((keys, cb) => {
            pendingGets.push({ keys, cb });
        });
        global.chrome.storage.local.set.mockImplementation((payload, cb) => {
            pendingSets.push({ payload, cb });
        });

        listener(saveRequest, validSender, jest.fn());
        listener(loadRequest, validSender, loadResponse);

        // The save's state read is still in flight, so the same-key load cannot begin a read.
        expect(pendingGets).toHaveLength(1);
        expect(loadResponse).not.toHaveBeenCalled();

        pendingGets[0].cb({});
        expect(pendingSets).toHaveLength(1);
        expect(pendingGets).toHaveLength(1);
        expect(loadResponse).not.toHaveBeenCalled();

        pendingSets[0].cb();
        await Promise.resolve();
        await Promise.resolve();

        expect(pendingGets).toHaveLength(2);
        expect(pendingGets[1].keys).toEqual([
            'sourcesPlusState_123',
            'sourcesPlusState_123__backup'
        ]);
        pendingGets[1].cb({
            sourcesPlusState_123: pendingSets[0].payload.sourcesPlusState_123
        });
        expect(loadResponse).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            data: expect.objectContaining({ _saveRevision: 1 })
        }));
    });

    it('loads a different notebook state immediately while another notebook save is pending', () => {
        const saveRequest = {
            type: 'SAVE_STATE',
            key: 'sourcesPlusState_123',
            baseRevision: 0,
            data: {
                groups: [],
                groupsById: {},
                sourceStateById: {}
            }
        };
        const loadRequest = { type: 'LOAD_STATE', key: 'sourcesPlusState_456' };
        const pendingGets = [];
        const loadResponse = jest.fn();

        global.chrome.storage.local.get.mockImplementation((keys, cb) => {
            pendingGets.push({ keys, cb });
        });

        listener(saveRequest, validSender, jest.fn());
        listener(loadRequest, senderForNotebook('456'), loadResponse);

        // The unrelated load has its own storage read even though notebook 123 is still saving.
        expect(pendingGets).toHaveLength(2);
        expect(pendingGets[1].keys).toEqual([
            'sourcesPlusState_456',
            'sourcesPlusState_456__backup'
        ]);
        pendingGets[1].cb({
            sourcesPlusState_456: { _saveRevision: 7, groups: ['other'] }
        });
        expect(loadResponse).toHaveBeenCalledWith({
            success: true,
            data: { _saveRevision: 7, groups: ['other'] }
        });
    });

    it('serializes APPEND_STATE_HISTORY behind a pending SAVE_STATE for the same notebook', async () => {
        // SAVE_STATE writes sourcesPlusState_123 AND its history (sourcesPlusHistory_123) in one
        // task; APPEND_STATE_HISTORY mutates the same history key. They must share one per-notebook
        // queue or a read-modify-write on the history array can drop an entry (lost update).
        const saveRequest = {
            type: 'SAVE_STATE',
            key: 'sourcesPlusState_123',
            baseRevision: 0,
            data: {
                groups: [],
                groupsById: {},
                ungrouped: [],
                sourceStateById: {},
                tagsById: {},
                tagOrder: [],
                sourceTagsById: {}
            }
        };
        const appendRequest = {
            type: 'APPEND_STATE_HISTORY',
            key: 'sourcesPlusHistory_123',
            entry: { snapshot: { groups: [] }, label: 'manual', createdAt: '2026-05-29T00:00:00.000Z' }
        };
        const pendingGets = [];
        const pendingSets = [];
        global.chrome.storage.local.get.mockImplementation((keys, cb) => { pendingGets.push(cb); });
        global.chrome.storage.local.set.mockImplementation((payload, cb) => { pendingSets.push({ payload, cb }); });

        listener(saveRequest, validSender, jest.fn());
        listener(appendRequest, validSender, jest.fn());

        // SAVE_STATE's get is in flight; the APPEND for the same notebook is queued behind it,
        // so it must NOT have issued its own get yet.
        expect(pendingGets).toHaveLength(1);

        // Drain SAVE_STATE (get → set) so the queued APPEND can run.
        pendingGets[0]({});
        expect(pendingSets).toHaveLength(1);
        pendingSets[0].cb();
        await Promise.resolve();
        await Promise.resolve();

        // Now the APPEND runs and reads the history the SAVE_STATE just wrote.
        expect(pendingGets).toHaveLength(2);
    });

    it('should not overwrite the backup snapshot when SAVE_STATE receives an empty payload', () => {
        const request = {
            type: 'SAVE_STATE',
            key: 'sourcesPlusState_123',
            data: {
                groups: [],
                groupsById: {},
                ungrouped: [],
                sourceStateById: {},
                tagsById: {},
                tagOrder: [],
                sourceTagsById: {}
            }
        };

        listener(request, validSender, mockSendResponse);

        expect(global.chrome.storage.local.set).toHaveBeenCalledWith(
            {
                'sourcesPlusState_123': expect.objectContaining({
                    ...request.data,
                    _saveRevision: 1,
                    _savedAt: expect.any(String)
                })
            },
            expect.any(Function)
        );
    });

    it('should reject SAVE_STATE with invalid key', () => {
        const request = {
            type: 'SAVE_STATE',
            key: 'invalidKey',
            data: { test: 123 }
        };

        listener(request, validSender, mockSendResponse);

        expect(global.chrome.storage.local.set).not.toHaveBeenCalled();
        expect(console.warn).toHaveBeenCalledWith(
            'GeminiNotebook-Source-Management: Received SAVE_STATE with invalid key:',
            'invalidKey'
        );
        expect(mockSendResponse).toHaveBeenCalledWith({
            success: false,
            errorCode: 'invalid_storage_key'
        });
    });

    it('should handle SAVE_STATE read error case', () => {
        const request = {
            type: 'SAVE_STATE',
            key: 'sourcesPlusState_123',
            data: { test: 123 }
        };

        // Set lastError before calling listener
        global.chrome.runtime.lastError = { message: 'Storage quota exceeded' };

        const result = listener(request, validSender, mockSendResponse);

        expect(console.error).toHaveBeenCalledWith(
            'GeminiNotebook-Source-Management background save error:',
            global.chrome.runtime.lastError
        );
        expect(mockSendResponse).toHaveBeenCalledWith({
            success: false,
            errorCode: 'runtime_failure'
        });
        expect(result).toBe(true);
    });

    it('saves and loads global developer preferences', () => {
        listener({
            type: 'SAVE_PREFERENCES',
            preferences: { developerModeEnabled: true, unknown: 'ignored' }
        }, {}, mockSendResponse);

        expect(global.chrome.storage.local.get).toHaveBeenCalledWith(
            ['sourcesPlusPreferences'],
            expect.any(Function)
        );
        expect(global.chrome.storage.local.set).toHaveBeenCalledWith(
            {
                sourcesPlusPreferences: {
                    developerModeEnabled: true,
                    welcomeOnboardingSeenVersion: 0,
                    whatsNewSeenVersion: '',
                    historyRetentionLimit: 20,
                    languageOverride: 'auto',
                    commandShortcuts: {},
                    visibleQuickViewKinds: DEFAULT_VISIBLE_QUICK_VIEW_KINDS,
                    dragMode: 'classic',
                    appearance: { hoverSpotlightEnabled: true }
                }
            },
            expect.any(Function)
        );
        expect(mockSendResponse).toHaveBeenCalledWith({
            success: true,
            preferences: {
                developerModeEnabled: true,
                welcomeOnboardingSeenVersion: 0,
                whatsNewSeenVersion: '',
                historyRetentionLimit: 20,
                languageOverride: 'auto',
                commandShortcuts: {},
                visibleQuickViewKinds: DEFAULT_VISIBLE_QUICK_VIEW_KINDS,
                dragMode: 'classic',
                appearance: { hoverSpotlightEnabled: true }
            }
        });

        mockSendResponse.mockClear();
        global.chrome.storage.local.get.mockImplementationOnce((keys, cb) => {
            cb({ sourcesPlusPreferences: { developerModeEnabled: true } });
        });

        listener({ type: 'LOAD_PREFERENCES' }, {}, mockSendResponse);

        expect(global.chrome.storage.local.get).toHaveBeenCalledWith(
            null,
            expect.any(Function)
        );
        expect(mockSendResponse).toHaveBeenCalledWith({
            success: true,
            preferences: {
                developerModeEnabled: true,
                welcomeOnboardingSeenVersion: 0,
                whatsNewSeenVersion: '',
                historyRetentionLimit: 20,
                languageOverride: 'auto',
                commandShortcuts: {},
                visibleQuickViewKinds: DEFAULT_VISIBLE_QUICK_VIEW_KINDS,
                dragMode: 'classic',
                appearance: { hoverSpotlightEnabled: true }
            },
            usageState: {
                hasExistingPluginData: true,
                hasStoredPreferences: true
            }
        });
    });

    it('reports whether stored extension data already exists when loading preferences', () => {
        global.chrome.storage.local.get.mockImplementationOnce((keys, cb) => {
            expect(keys).toBeNull();
            cb({});
        });

        listener({ type: 'LOAD_PREFERENCES' }, {}, mockSendResponse);

        expect(mockSendResponse).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            usageState: {
                hasExistingPluginData: false,
                hasStoredPreferences: false
            }
        }));

        mockSendResponse.mockClear();
        global.chrome.storage.local.get.mockImplementationOnce((keys, cb) => {
            expect(keys).toBeNull();
            cb({
                sourcesPlusState_abc: { schemaVersion: 4 }
            });
        });

        listener({ type: 'LOAD_PREFERENCES' }, {}, mockSendResponse);

        expect(mockSendResponse).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            usageState: {
                hasExistingPluginData: true,
                hasStoredPreferences: false
            }
        }));
    });

    it('merges welcome onboarding preference updates without clearing developer mode', () => {
        global.chrome.storage.local.get.mockImplementationOnce((keys, cb) => {
            cb({ sourcesPlusPreferences: { developerModeEnabled: true, welcomeOnboardingSeenVersion: 0 } });
        });

        listener({
            type: 'SAVE_PREFERENCES',
            preferences: { welcomeOnboardingSeenVersion: 1 }
        }, {}, mockSendResponse);

        expect(global.chrome.storage.local.get).toHaveBeenCalledWith(
            ['sourcesPlusPreferences'],
            expect.any(Function)
        );
        expect(global.chrome.storage.local.set).toHaveBeenCalledWith(
            {
                sourcesPlusPreferences: {
                    developerModeEnabled: true,
                    welcomeOnboardingSeenVersion: 1,
                    whatsNewSeenVersion: '',
                    historyRetentionLimit: 20,
                    languageOverride: 'auto',
                    commandShortcuts: {},
                    visibleQuickViewKinds: DEFAULT_VISIBLE_QUICK_VIEW_KINDS,
                    dragMode: 'classic',
                    appearance: { hoverSpotlightEnabled: true }
                }
            },
            expect.any(Function)
        );
        expect(mockSendResponse).toHaveBeenCalledWith({
            success: true,
            preferences: {
                developerModeEnabled: true,
                welcomeOnboardingSeenVersion: 1,
                whatsNewSeenVersion: '',
                historyRetentionLimit: 20,
                languageOverride: 'auto',
                commandShortcuts: {},
                visibleQuickViewKinds: DEFAULT_VISIBLE_QUICK_VIEW_KINDS,
                dragMode: 'classic',
                appearance: { hoverSpotlightEnabled: true }
            }
        });
    });

    it('saves whats new, history retention, and language preferences without clearing existing fields', () => {
        global.chrome.storage.local.get.mockImplementationOnce((keys, cb) => {
            cb({
                sourcesPlusPreferences: {
                    developerModeEnabled: true,
                    welcomeOnboardingSeenVersion: 1,
                    whatsNewSeenVersion: '',
                    historyRetentionLimit: 20,
                    languageOverride: 'auto'
                }
            });
        });

        listener({
            type: 'SAVE_PREFERENCES',
            preferences: {
                whatsNewSeenVersion: '2.7.4',
                historyRetentionLimit: 50,
                languageOverride: 'zh_CN'
            }
        }, {}, mockSendResponse);

        expect(global.chrome.storage.local.set).toHaveBeenCalledWith(
            {
                sourcesPlusPreferences: {
                    developerModeEnabled: true,
                    welcomeOnboardingSeenVersion: 1,
                    whatsNewSeenVersion: '2.7.4',
                    historyRetentionLimit: 50,
                    languageOverride: 'zh_CN',
                    commandShortcuts: {},
                    visibleQuickViewKinds: DEFAULT_VISIBLE_QUICK_VIEW_KINDS,
                    dragMode: 'classic',
                    appearance: { hoverSpotlightEnabled: true }
                }
            },
            expect.any(Function)
        );
    });

    it('saves command shortcuts without clearing existing preferences', () => {
        global.chrome.storage.local.get.mockImplementationOnce((keys, cb) => {
            cb({
                sourcesPlusPreferences: {
                    developerModeEnabled: true,
                    welcomeOnboardingSeenVersion: 1,
                    whatsNewSeenVersion: '2.7.4',
                    historyRetentionLimit: 50,
                    languageOverride: 'zh_CN',
                    commandShortcuts: {
                        'quick-view-recent': 'Meta+Shift+R'
                    }
                }
            });
        });

        listener({
            type: 'SAVE_PREFERENCES',
            preferences: {
                commandShortcuts: {
                    'quick-view-recent': '',
                    'quick-view-issues': 'Ctrl+Alt+I',
                    '../bad': 'Meta+X'
                }
            }
        }, {}, mockSendResponse);

        expect(global.chrome.storage.local.set).toHaveBeenCalledWith(
            {
                sourcesPlusPreferences: {
                    developerModeEnabled: true,
                    welcomeOnboardingSeenVersion: 1,
                    whatsNewSeenVersion: '2.7.4',
                    historyRetentionLimit: 50,
                    languageOverride: 'zh_CN',
                    commandShortcuts: {
                        'quick-view-issues': 'Ctrl+Alt+I'
                    },
                    visibleQuickViewKinds: DEFAULT_VISIBLE_QUICK_VIEW_KINDS,
                    dragMode: 'classic',
                    appearance: { hoverSpotlightEnabled: true }
                }
            },
            expect.any(Function)
        );
    });

    it('saves visible quick view button preferences without clearing existing preferences', () => {
        global.chrome.storage.local.get.mockImplementationOnce((keys, cb) => {
            cb({
                sourcesPlusPreferences: {
                    developerModeEnabled: true,
                    welcomeOnboardingSeenVersion: 1,
                    whatsNewSeenVersion: '2.7.4',
                    historyRetentionLimit: 50,
                    languageOverride: 'zh_CN',
                    commandShortcuts: {
                        'quick-view-recent': 'Meta+Shift+R'
                    },
                    visibleQuickViewKinds: ['all', 'recent', 'issues']
                }
            });
        });

        listener({
            type: 'SAVE_PREFERENCES',
            preferences: {
                visibleQuickViewKinds: ['issues', 'bad-kind', 'all', 'issues']
            }
        }, {}, mockSendResponse);

        expect(global.chrome.storage.local.set).toHaveBeenCalledWith(
            {
                sourcesPlusPreferences: {
                    developerModeEnabled: true,
                    welcomeOnboardingSeenVersion: 1,
                    whatsNewSeenVersion: '2.7.4',
                    historyRetentionLimit: 50,
                    languageOverride: 'zh_CN',
                    commandShortcuts: {
                        'quick-view-recent': 'Meta+Shift+R'
                    },
                    visibleQuickViewKinds: ['all', 'issues'],
                    dragMode: 'classic',
                    appearance: { hoverSpotlightEnabled: true }
                }
            },
            expect.any(Function)
        );

        mockSendResponse.mockClear();
        global.chrome.storage.local.get.mockImplementationOnce((keys, cb) => {
            cb({ sourcesPlusPreferences: { visibleQuickViewKinds: [] } });
        });

        listener({ type: 'LOAD_PREFERENCES' }, {}, mockSendResponse);

        expect(mockSendResponse).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            preferences: expect.objectContaining({
                visibleQuickViewKinds: []
            })
        }));
    });

    it('serializes concurrent preference saves so partial updates do not overwrite each other', async () => {
        const pendingGets = [];
        const pendingSets = [];
        global.chrome.storage.local.get.mockImplementation((keys, cb) => {
            pendingGets.push(cb);
        });
        global.chrome.storage.local.set.mockImplementation((payload, cb) => {
            pendingSets.push({ payload, cb });
        });

        listener({
            type: 'SAVE_PREFERENCES',
            preferences: { welcomeOnboardingSeenVersion: 1 }
        }, {}, mockSendResponse);
        listener({
            type: 'SAVE_PREFERENCES',
            preferences: { languageOverride: 'zh_CN' }
        }, {}, mockSendResponse);

        expect(pendingGets).toHaveLength(1);

        pendingGets.shift()({ sourcesPlusPreferences: { developerModeEnabled: true } });
        expect(pendingSets).toHaveLength(1);
        expect(pendingSets[0].payload.sourcesPlusPreferences).toMatchObject({
            developerModeEnabled: true,
            welcomeOnboardingSeenVersion: 1,
            languageOverride: 'auto'
        });
        pendingSets.shift().cb();

        expect(mockSendResponse).toHaveBeenCalledTimes(1);
        await Promise.resolve();
        await Promise.resolve();
        expect(pendingGets).toHaveLength(1);

        pendingGets.shift()({
            sourcesPlusPreferences: {
                developerModeEnabled: true,
                welcomeOnboardingSeenVersion: 1,
                whatsNewSeenVersion: '',
                historyRetentionLimit: 20,
                languageOverride: 'auto',
                commandShortcuts: {}
            }
        });
        expect(pendingSets).toHaveLength(1);
        expect(pendingSets[0].payload.sourcesPlusPreferences).toMatchObject({
            developerModeEnabled: true,
            welcomeOnboardingSeenVersion: 1,
            languageOverride: 'zh_CN'
        });
        pendingSets.shift().cb();

        expect(mockSendResponse).toHaveBeenCalledTimes(2);
    });

    it('rejects developer log writes from unauthorized senders', () => {
        const invalidSender = {
            tab: { url: 'https://example.com/notebook/123' }
        };

        listener({
            type: 'APPEND_DEVELOPER_LOG',
            key: 'sourcesPlusDeveloperLogs_123',
            entry: { event: 'delete_failed' }
        }, invalidSender, mockSendResponse);

        expect(global.chrome.storage.local.get).not.toHaveBeenCalled();
        expect(global.chrome.storage.local.set).not.toHaveBeenCalled();
        expect(mockSendResponse).toHaveBeenCalledWith({
            success: false,
            errorCode: 'unauthorized_sender'
        });
    });

    it('rejects invalid developer log storage keys', () => {
        listener({
            type: 'APPEND_DEVELOPER_LOG',
            key: 'sourcesPlusState_123',
            entry: { event: 'delete_failed' }
        }, validSender, mockSendResponse);

        expect(global.chrome.storage.local.get).not.toHaveBeenCalled();
        expect(global.chrome.storage.local.set).not.toHaveBeenCalled();
        expect(mockSendResponse).toHaveBeenCalledWith({
            success: false,
            errorCode: 'invalid_storage_key'
        });
    });

    it('appends developer logs with bounded history', () => {
        const existingLogs = Array.from({ length: 500 }, (_, index) => ({
            id: `old-${index}`,
            timestamp: '2026-05-15T00:00:00.000Z',
            level: 'debug',
            category: 'ui',
            event: 'old_event',
            notebookId: '123',
            details: { index }
        }));
        global.chrome.storage.local.get.mockImplementationOnce((keys, cb) => {
            cb({ sourcesPlusDeveloperLogs_123: existingLogs });
        });

        listener({
            type: 'APPEND_DEVELOPER_LOG',
            key: 'sourcesPlusDeveloperLogs_123',
            entry: {
                id: 'new',
                timestamp: '2026-05-15T00:01:00.000Z',
                level: 'warn',
                category: 'native_action',
                event: 'delete_failed',
                notebookId: '123',
                details: { reason: 'confirm_dialog_missing' }
            }
        }, validSender, mockSendResponse);

        const savedPayload = global.chrome.storage.local.set.mock.calls[0][0];
        expect(savedPayload.sourcesPlusDeveloperLogs_123).toHaveLength(500);
        expect(savedPayload.sourcesPlusDeveloperLogs_123[0].id).toBe('old-1');
        expect(savedPayload.sourcesPlusDeveloperLogs_123[499].id).toBe('new');
        expect(mockSendResponse).toHaveBeenCalledWith({
            success: true,
            logs: savedPayload.sourcesPlusDeveloperLogs_123
        });
    });

    it('should handle SAVE_STATE write error case', () => {
        const request = {
            type: 'SAVE_STATE',
            key: 'sourcesPlusState_123',
            data: { test: 123 }
        };

        global.chrome.storage.local.get.mockImplementationOnce((keys, cb) => {
            cb({});
        });
        global.chrome.storage.local.set.mockImplementationOnce((data, cb) => {
            global.chrome.runtime.lastError = { message: 'Storage quota exceeded' };
            cb();
        });

        const result = listener(request, validSender, mockSendResponse);

        expect(global.chrome.storage.local.set).toHaveBeenCalled();
        expect(console.error).toHaveBeenCalledWith(
            'GeminiNotebook-Source-Management background save error:',
            global.chrome.runtime.lastError
        );
        expect(mockSendResponse).toHaveBeenCalledWith(expect.objectContaining({
            success: false,
            errorCode: 'storage_quota_exceeded',
            storageUsageBytes: expect.any(Number),
            storageQuotaBytes: expect.any(Number),
            storageUsageRatio: expect.any(Number)
        }));
        expect(result).toBe(true);
    });

    it('returns storage warning metadata when projected save payload is near quota', () => {
        const request = {
            type: 'SAVE_STATE',
            key: 'sourcesPlusState_123',
            data: {
                groups: ['large'],
                groupsById: { large: { id: 'large', children: [] } },
                sourceStateById: {
                    source_1: { enabled: true, title: 'x'.repeat(1200) }
                }
            }
        };
        global.chrome.storage.local.QUOTA_BYTES = 5500;

        listener(request, validSender, mockSendResponse);

        expect(mockSendResponse).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            storageWarning: true,
            storageUsageBytes: expect.any(Number),
            storageQuotaBytes: 5500,
            storageUsageRatio: expect.any(Number)
        }));
    });

    it('drives the quota warning from real total usage via getBytesInUse, not just this write', () => {
        const request = {
            type: 'SAVE_STATE',
            key: 'sourcesPlusState_warn',
            data: {
                groups: ['g'],
                groupsById: { g: { id: 'g', children: [] } },
                sourceStateById: {}
            }
        };
        // This notebook's payload is tiny, but ~9MB is already used across OTHER notebooks,
        // so the projected total ratio (~0.9 of the default 10MB) should trip the warning.
        global.chrome.storage.local.getBytesInUse = jest.fn((keys, cb) => cb(9 * 1024 * 1024));

        listener(request, senderForNotebook('warn'), mockSendResponse);

        expect(global.chrome.storage.local.getBytesInUse).toHaveBeenCalled();
        expect(mockSendResponse).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            storageWarning: true
        }));
    });

    it('rejects a growing write when getBytesInUse shows projected total usage is critical', () => {
        const request = {
            type: 'SAVE_STATE',
            key: 'sourcesPlusState_crit',
            baseRevision: 0,
            data: {
                groups: ['g'],
                groupsById: { g: { id: 'g', children: [] } },
                sourceStateById: {}
            }
        };
        // Other notebooks already sit just under the 10MB quota; this notebook is new (grows
        // from 0), so the projected total is critical and the growing write must be rejected.
        global.chrome.storage.local.getBytesInUse = jest.fn((keys, cb) => cb(Math.round(9.97 * 1024 * 1024)));

        listener(request, senderForNotebook('crit'), mockSendResponse);

        expect(global.chrome.storage.local.set).not.toHaveBeenCalled();
        expect(mockSendResponse).toHaveBeenCalledWith(expect.objectContaining({
            success: false,
            errorCode: 'storage_quota_exceeded'
        }));
    });

    it('trims state history once when projected save payload is over the critical quota threshold', () => {
        const existingHistory = [1, 2, 3, 4, 5].map((index) => ({
            id: `history-${index}`,
            createdAt: `2026-04-22T00:0${index}:00.000Z`,
            reason: 'save',
            snapshot: {
                groups: [`old-${index}`],
                groupsById: { [`old-${index}`]: { id: `old-${index}`, children: [] } },
                sourceStateById: {
                    [`source-${index}`]: { enabled: true, title: 'x'.repeat(900) }
                }
            }
        }));
        const request = {
            type: 'SAVE_STATE',
            key: 'sourcesPlusState_123',
            data: {
                groups: ['current'],
                groupsById: { current: { id: 'current', children: [] } },
                sourceStateById: {
                    source_current: { enabled: true, title: 'Current' }
                }
            }
        };
        global.chrome.storage.local.QUOTA_BYTES = 5200;
        global.chrome.storage.local.get.mockImplementationOnce((keys, cb) => {
            cb({ sourcesPlusHistory_123: existingHistory });
        });

        listener(request, validSender, mockSendResponse);

        const savedPayload = global.chrome.storage.local.set.mock.calls[0][0];
        expect(savedPayload.sourcesPlusHistory_123).toHaveLength(1);
        expect(mockSendResponse).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            historyEntryCount: 1,
            historyTrimmed: true
        }));
    });

    it('returns storage_quota_exceeded when trimming history cannot reduce the payload enough', () => {
        const request = {
            type: 'SAVE_STATE',
            key: 'sourcesPlusState_123',
            data: {
                groups: ['oversized'],
                groupsById: { oversized: { id: 'oversized', children: [] } },
                sourceStateById: {
                    source_1: { enabled: true, title: 'x'.repeat(4000) }
                }
            }
        };
        global.chrome.storage.local.QUOTA_BYTES = 2000;

        listener(request, validSender, mockSendResponse);

        expect(global.chrome.storage.local.set).not.toHaveBeenCalled();
        expect(mockSendResponse).toHaveBeenCalledWith(expect.objectContaining({
            success: false,
            errorCode: 'storage_quota_exceeded',
            storageUsageBytes: expect.any(Number),
            storageQuotaBytes: 2000
        }));
    });

    it('allows a shrinking save even when over the critical quota threshold (no delete lock)', () => {
        const key = 'sourcesPlusState_shrink';
        // Large state already stored — well over the (tiny) quota.
        const currentState = {
            groups: ['g'],
            groupsById: { g: { id: 'g', children: [] } },
            sourceStateById: { big: { enabled: true, title: 'x'.repeat(5000) } },
            _saveRevision: 1
        };
        global.chrome.storage.local.QUOTA_BYTES = 3400;
        global.chrome.storage.local.get.mockImplementationOnce((keys, cb) => {
            cb({ [key]: currentState, [`${key}__backup`]: currentState });
        });
        const request = {
            type: 'SAVE_STATE',
            key,
            baseRevision: 1,
            data: {
                // User deleted the big source → strictly smaller than current.
                groups: ['g'],
                groupsById: { g: { id: 'g', children: [] } },
                sourceStateById: { small: { enabled: true, title: 'x'.repeat(3000) } }
            }
        };

        listener(request, senderForNotebook('shrink'), mockSendResponse);

        // The shrinking write must go through even while critical — otherwise a user
        // who filled their quota could never delete sources to recover (hard lock).
        expect(global.chrome.storage.local.set).toHaveBeenCalled();
        expect(mockSendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should handle LOAD_STATE message successfully', () => {
        const request = {
            type: 'LOAD_STATE',
            key: 'sourcesPlusState_123'
        };

        // Mock get to return some data
        global.chrome.storage.local.get.mockImplementationOnce((key, cb) => {
            cb({ 'sourcesPlusState_123': { loadedData: true, sourceStateById: { source_1: { enabled: true } } } });
        });

        const result = listener(request, validSender, mockSendResponse);

        expect(global.chrome.storage.local.get).toHaveBeenCalledWith(
            ['sourcesPlusState_123', 'sourcesPlusState_123__backup'],
            expect.any(Function)
        );
        expect(mockSendResponse).toHaveBeenCalledWith({
            success: true,
            data: { loadedData: true, sourceStateById: { source_1: { enabled: true } } }
        });
        expect(result).toBe(true); // Should return true to keep channel open
    });

    it('should fall back to the local backup snapshot when the primary state is empty', () => {
        const request = {
            type: 'LOAD_STATE',
            key: 'sourcesPlusState_123'
        };

        global.chrome.storage.local.get.mockImplementationOnce((key, cb) => {
            cb({
                'sourcesPlusState_123': {
                    groups: [],
                    groupsById: {},
                    ungrouped: [],
                    sourceStateById: {},
                    tagsById: {},
                    tagOrder: [],
                    sourceTagsById: {}
                },
                'sourcesPlusState_123__backup': {
                    groups: ['group1'],
                    groupsById: { group1: { id: 'group1', children: [{ type: 'source', key: 'source_1' }] } },
                    ungrouped: [],
                    sourceStateById: { source_1: { enabled: true } }
                }
            });
        });

        listener(request, validSender, mockSendResponse);

        expect(mockSendResponse).toHaveBeenCalledWith({
            success: true,
            data: {
                groups: ['group1'],
                groupsById: { group1: { id: 'group1', children: [{ type: 'source', key: 'source_1' }] } },
                ungrouped: [],
                sourceStateById: { source_1: { enabled: true } }
            }
        });
    });

    it('should reject LOAD_STATE when storage get fails', () => {
        const request = {
            type: 'LOAD_STATE',
            key: 'sourcesPlusState_123'
        };

        global.chrome.storage.local.get.mockImplementationOnce((key, cb) => {
            global.chrome.runtime.lastError = { message: 'Storage unavailable' };
            cb({});
            global.chrome.runtime.lastError = undefined;
        });

        const result = listener(request, validSender, mockSendResponse);

        expect(global.chrome.storage.local.get).toHaveBeenCalledWith(
            ['sourcesPlusState_123', 'sourcesPlusState_123__backup'],
            expect.any(Function)
        );
        expect(console.error).toHaveBeenCalledWith(
            'GeminiNotebook-Source-Management background load error:',
            { message: 'Storage unavailable' }
        );
        expect(mockSendResponse).toHaveBeenCalledWith({
            success: false,
            errorCode: 'runtime_failure'
        });
        expect(result).toBe(true);
    });

    it('should reject LOAD_STATE with invalid key', () => {
        const request = {
            type: 'LOAD_STATE',
            key: 'invalidKey'
        };

        listener(request, validSender, mockSendResponse);

        expect(global.chrome.storage.local.get).not.toHaveBeenCalled();
        expect(console.warn).toHaveBeenCalledWith(
            'GeminiNotebook-Source-Management: Received LOAD_STATE with invalid key:',
            'invalidKey'
        );
        expect(mockSendResponse).toHaveBeenCalledWith({
            success: false,
            errorCode: 'invalid_storage_key'
        });
    });

    it('should reject LOAD_STATE when sender is unauthorized', () => {
        const invalidSender = {
            tab: {
                url: 'https://example.com'
            }
        };

        listener({
            type: 'LOAD_STATE',
            key: 'sourcesPlusState_123'
        }, invalidSender, mockSendResponse);

        expect(mockSendResponse).toHaveBeenCalledWith({
            success: false,
            errorCode: 'unauthorized_sender'
        });
        expect(global.chrome.storage.local.get).not.toHaveBeenCalled();
    });

    it('should handle LOAD_STATE message returning null when data not found', () => {
        const request = {
            type: 'LOAD_STATE',
            key: 'sourcesPlusState_123'
        };

        // Mock get to return empty object
        global.chrome.storage.local.get.mockImplementationOnce((key, cb) => {
            cb({});
        });

        listener(request, validSender, mockSendResponse);

        expect(mockSendResponse).toHaveBeenCalledWith({
            success: true,
            data: null
        });
    });

    it('loads state history entries for authorized notebook senders', () => {
        const history = [{
            id: 'entry-1',
            createdAt: '2026-04-22T00:00:00.000Z',
            reason: 'save',
            sourceCount: 1,
            groupCount: 1,
            tagCount: 0,
            saveRevision: 2,
            snapshot: {
                _saveRevision: 2,
                groups: ['group1'],
                groupsById: { group1: { id: 'group1', children: [{ type: 'source', key: 'source_1' }] } },
                sourceStateById: { source_1: { enabled: true } }
            }
        }];
        global.chrome.storage.local.get.mockImplementationOnce((keys, cb) => {
            cb({ sourcesPlusHistory_123: history });
        });

        listener({ type: 'LOAD_STATE_HISTORY', key: 'sourcesPlusHistory_123' }, validSender, mockSendResponse);

        expect(global.chrome.storage.local.get).toHaveBeenCalledWith(
            ['sourcesPlusHistory_123', 'sourcesPlusPreferences'],
            expect.any(Function)
        );
        expect(mockSendResponse).toHaveBeenCalledWith({
            success: true,
            history: [expect.objectContaining({
                id: 'entry-1',
                label: '',
                manual: false
            })]
        });
    });

    it('appends state history entries with de-duplication and the default twenty entry limit', () => {
        const makeEntry = (index) => ({
            id: `entry-${index}`,
            createdAt: `2026-04-22T00:0${index}:00.000Z`,
            reason: 'save',
            snapshot: {
                groups: [`group-${index}`],
                groupsById: { [`group-${index}`]: { id: `group-${index}`, children: [] } },
                sourceStateById: {}
            }
        });
        const existing = Array.from({ length: 20 }, (_, index) => makeEntry(index + 1));
        global.chrome.storage.local.get.mockImplementationOnce((keys, cb) => {
            cb({ sourcesPlusHistory_123: existing });
        });

        listener({
            type: 'APPEND_STATE_HISTORY',
            key: 'sourcesPlusHistory_123',
            entry: makeEntry(6)
        }, validSender, mockSendResponse);

        const savedHistory = global.chrome.storage.local.set.mock.calls[0][0].sourcesPlusHistory_123;
        expect(savedHistory).toHaveLength(20);
        expect(savedHistory.map((entry) => entry.id)).toEqual([
            'entry-6',
            ...Array.from({ length: 20 }, (_, index) => `entry-${index + 1}`).filter((id) => id !== 'entry-6')
        ]);
        expect(mockSendResponse).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            history: savedHistory
        }));
    });

    it('uses configured history retention and preserves manual restore points during trimming', () => {
        const makeEntry = (index, manual = false) => ({
            id: `entry-${index}`,
            createdAt: `2026-04-22T00:${String(index).padStart(2, '0')}:00.000Z`,
            reason: manual ? 'manual_restore_point' : 'save',
            manual,
            label: manual ? `Restore ${index}` : '',
            snapshot: {
                groups: [`group-${index}`],
                groupsById: { [`group-${index}`]: { id: `group-${index}`, children: [] } },
                sourceStateById: {}
            }
        });
        const existing = [
            ...Array.from({ length: 25 }, (_, index) => makeEntry(index + 1)),
            makeEntry(101, true)
        ];
        global.chrome.storage.local.get.mockImplementationOnce((keys, cb) => {
            cb({
                sourcesPlusPreferences: { historyRetentionLimit: 20 },
                sourcesPlusHistory_123: existing
            });
        });

        listener({
            type: 'APPEND_STATE_HISTORY',
            key: 'sourcesPlusHistory_123',
            entry: makeEntry(26)
        }, validSender, mockSendResponse);

        const savedHistory = global.chrome.storage.local.set.mock.calls[0][0].sourcesPlusHistory_123;
        expect(savedHistory).toHaveLength(20);
        expect(savedHistory.some((entry) => entry.id === 'entry-101' && entry.manual)).toBe(true);
        expect(savedHistory.map((entry) => entry.id)).toContain('entry-26');
        expect(savedHistory.map((entry) => entry.id)).not.toContain('entry-20');
    });

    it('serializes concurrent state history appends for the same key', async () => {
        const makeEntry = (index) => ({
            id: `entry-${index}`,
            createdAt: `2026-04-22T00:0${index}:00.000Z`,
            reason: 'manual',
            snapshot: {
                groups: [`group-${index}`],
                groupsById: { [`group-${index}`]: { id: `group-${index}`, children: [] } },
                sourceStateById: {}
            }
        });
        const store = { sourcesPlusHistory_123: [] };
        const pendingGets = [];
        const responses = [];
        global.chrome.storage.local.get.mockImplementation((keys, cb) => {
            pendingGets.push({ keys, cb });
        });
        global.chrome.storage.local.set.mockImplementation((payload, cb) => {
            Object.assign(store, payload);
            cb();
        });

        listener({
            type: 'APPEND_STATE_HISTORY',
            key: 'sourcesPlusHistory_123',
            entry: makeEntry(1)
        }, validSender, (response) => responses.push(response));
        listener({
            type: 'APPEND_STATE_HISTORY',
            key: 'sourcesPlusHistory_123',
            entry: makeEntry(2)
        }, validSender, (response) => responses.push(response));

        expect(pendingGets).toHaveLength(1);
        pendingGets.shift().cb({ ...store });
        await Promise.resolve();
        await Promise.resolve();

        expect(pendingGets).toHaveLength(1);
        pendingGets.shift().cb({ ...store });
        await Promise.resolve();
        await Promise.resolve();

        expect(responses).toHaveLength(2);
        expect(store.sourcesPlusHistory_123.map((entry) => entry.id)).toEqual([
            'entry-2',
            'entry-1'
        ]);
    });

    it('waits for a pending history append before loading history for the same key', async () => {
        const entry = {
            id: 'entry-1',
            createdAt: '2026-04-22T00:01:00.000Z',
            reason: 'manual',
            snapshot: {
                groups: ['group-1'],
                groupsById: { 'group-1': { id: 'group-1', children: [] } },
                sourceStateById: {}
            }
        };
        const store = { sourcesPlusHistory_123: [] };
        const pendingGets = [];
        const appendResponses = [];
        const loadResponses = [];
        global.chrome.storage.local.get.mockImplementation((keys, cb) => {
            pendingGets.push({ keys, cb });
        });
        global.chrome.storage.local.set.mockImplementation((payload, cb) => {
            Object.assign(store, payload);
            cb();
        });

        listener({
            type: 'APPEND_STATE_HISTORY',
            key: 'sourcesPlusHistory_123',
            entry
        }, validSender, (response) => appendResponses.push(response));
        listener({
            type: 'LOAD_STATE_HISTORY',
            key: 'sourcesPlusHistory_123'
        }, validSender, (response) => loadResponses.push(response));

        expect(pendingGets).toHaveLength(1);
        expect(loadResponses).toHaveLength(0);

        pendingGets.shift().cb({ ...store });
        await Promise.resolve();
        await Promise.resolve();

        expect(appendResponses).toHaveLength(1);
        expect(pendingGets).toHaveLength(1);
        pendingGets.shift().cb({ ...store });

        expect(loadResponses).toHaveLength(1);
        expect(loadResponses[0].history.map((historyEntry) => historyEntry.id)).toEqual(['entry-1']);
    });

    it('rejects state history messages with invalid keys', () => {
        listener({ type: 'LOAD_STATE_HISTORY', key: 'sourcesPlusState_123' }, validSender, mockSendResponse);

        expect(global.chrome.storage.local.get).not.toHaveBeenCalled();
        expect(mockSendResponse).toHaveBeenCalledWith({
            success: false,
            errorCode: 'invalid_storage_key'
        });
    });

    it('returns enabled=true when extensionEnabled is missing', () => {
        global.chrome.storage.local.get.mockImplementationOnce((keys, cb) => {
            cb({});
        });

        listener({ type: 'GET_EXTENSION_ENABLED' }, {}, mockSendResponse);

        expect(mockSendResponse).toHaveBeenCalledWith({
            success: true,
            enabled: true
        });
    });

    it('returns enabled=false when extensionEnabled is stored as false', () => {
        global.chrome.storage.local.get.mockImplementationOnce((keys, cb) => {
            cb({ extensionEnabled: false });
        });

        listener({ type: 'GET_EXTENSION_ENABLED' }, {}, mockSendResponse);

        expect(mockSendResponse).toHaveBeenCalledWith({
            success: true,
            enabled: false
        });
    });

    it('persists extensionEnabled=false and forwards DISABLE_MANAGER to the active NotebookLM tab', () => {
        const sender = {};

        listener({
            type: 'SET_EXTENSION_ENABLED',
            enabled: false,
            tabId: 42
        }, sender, mockSendResponse);

        expect(global.chrome.storage.local.set).toHaveBeenCalledWith(
            { extensionEnabled: false },
            expect.any(Function)
        );
        expect(global.chrome.tabs.sendMessage).toHaveBeenCalledWith(
            42,
            { type: 'DISABLE_MANAGER' },
            expect.any(Function)
        );
    });

    it('persists extensionEnabled=true and forwards ENABLE_MANAGER to the active NotebookLM tab', () => {
        const sender = {};

        listener({
            type: 'SET_EXTENSION_ENABLED',
            enabled: true,
            tabId: 42
        }, sender, mockSendResponse);

        expect(global.chrome.storage.local.set).toHaveBeenCalledWith(
            { extensionEnabled: true },
            expect.any(Function)
        );
        expect(global.chrome.tabs.sendMessage).toHaveBeenCalledWith(
            42,
            { type: 'ENABLE_MANAGER' },
            expect.any(Function)
        );
    });

    it('keeps the persisted enabled state even if tab forwarding fails', () => {
        global.chrome.tabs.sendMessage.mockImplementationOnce((tabId, message, cb) => {
            global.chrome.runtime.lastError = { message: 'Could not establish connection' };
            cb();
            global.chrome.runtime.lastError = undefined;
        });

        listener({
            type: 'SET_EXTENSION_ENABLED',
            enabled: true,
            tabId: 42
        }, {}, mockSendResponse);

        expect(global.chrome.storage.local.set).toHaveBeenCalledWith(
            { extensionEnabled: true },
            expect.any(Function)
        );
        expect(global.chrome.storage.local.set.mock.invocationCallOrder[0]).toBeLessThan(
            global.chrome.tabs.sendMessage.mock.invocationCallOrder[0]
        );
        expect(mockSendResponse).toHaveBeenCalledWith({
            success: true,
            enabled: true,
            forwarded: false,
            forwardErrorCode: 'tab_message_failed'
        });
    });

    it('should focus an existing NotebookLM notebook tab for launcher requests', () => {
        global.chrome.tabs.query.mockImplementationOnce((queryInfo, cb) => {
            cb([
                { id: 12, url: 'https://notebooklm.google.com/', windowId: 3 },
                { id: 44, url: 'https://notebooklm.google.com/notebook/abc', windowId: 5 }
            ]);
        });

        const result = listener({
            type: 'OPEN_OR_FOCUS_NOTEBOOKLM',
            currentTabId: 12,
            currentContext: 'external'
        }, {}, mockSendResponse);

        expect(global.chrome.tabs.query).toHaveBeenCalledWith(
            { url: 'https://notebooklm.google.com/*' },
            expect.any(Function)
        );
        expect(global.chrome.tabs.update).toHaveBeenCalledWith(
            44,
            { active: true },
            expect.any(Function)
        );
        expect(global.chrome.windows.update).toHaveBeenCalledWith(
            5,
            { focused: true },
            expect.any(Function)
        );
        expect(mockSendResponse).toHaveBeenCalledWith({
            success: true,
            action: 'focused-existing-notebook',
            tabId: 44,
            url: 'https://notebooklm.google.com/notebook/123'
        });
        expect(result).toBe(true);
    });

    it('should surface a tabs query failure when launcher requests cannot read tabs', () => {
        global.chrome.tabs.query.mockImplementationOnce((queryInfo, cb) => {
            global.chrome.runtime.lastError = { message: 'tabs query failed' };
            cb([]);
            global.chrome.runtime.lastError = undefined;
        });

        const result = listener({
            type: 'OPEN_OR_FOCUS_NOTEBOOKLM',
            currentTabId: 12,
            currentContext: 'external'
        }, {}, mockSendResponse);

        expect(mockSendResponse).toHaveBeenCalledWith({
            success: false,
            errorCode: 'tabs_query_failed'
        });
        expect(result).toBe(true);
    });

    it('should build Chrome Web Store reviews from the runtime extension id for feedback requests', () => {
        const result = listener({ type: 'OPEN_WEB_STORE_FEEDBACK' }, {}, mockSendResponse);

        expect(global.chrome.tabs.create).toHaveBeenCalledWith(
            { url: 'https://chrome.google.com/webstore/detail/abcdefghijklmnopabcdefghijklmnop/reviews' },
            expect.any(Function)
        );
        expect(mockSendResponse).toHaveBeenCalledWith({
            success: true,
            tabId: 99,
            url: 'https://chrome.google.com/webstore/detail/abcdefghijklmnopabcdefghijklmnop/reviews'
        });
        expect(result).toBe(true);
    });

    it('should prefer a Chrome Web Store homepage_url when one is configured for feedback requests', () => {
        global.chrome.runtime.getManifest.mockReturnValueOnce({
            homepage_url: 'https://chromewebstore.google.com/detail/custom-extension/customabcdefghijklmnopqrstuvwx'
        });

        const result = listener({ type: 'OPEN_WEB_STORE_FEEDBACK' }, {}, mockSendResponse);

        expect(global.chrome.tabs.create).toHaveBeenCalledWith(
            { url: 'https://chromewebstore.google.com/detail/custom-extension/customabcdefghijklmnopqrstuvwx/reviews' },
            expect.any(Function)
        );
        expect(mockSendResponse).toHaveBeenCalledWith({
            success: true,
            tabId: 99,
            url: 'https://chromewebstore.google.com/detail/custom-extension/customabcdefghijklmnopqrstuvwx/reviews'
        });
        expect(result).toBe(true);
    });

    it('should reject feedback requests when the runtime extension id is missing', () => {
        delete global.chrome.runtime.id;

        const result = listener({ type: 'OPEN_WEB_STORE_FEEDBACK' }, {}, mockSendResponse);

        expect(global.chrome.tabs.create).not.toHaveBeenCalled();
        expect(mockSendResponse).toHaveBeenCalledWith({
            success: false,
            errorCode: 'runtime_failure'
        });
        expect(result).toBe(true);
    });

    it('should surface a tab create failure when Chrome Web Store feedback cannot open', () => {
        global.chrome.tabs.create.mockImplementationOnce((createProperties, cb) => {
            global.chrome.runtime.lastError = { message: 'tab create failed' };
            cb(null);
            global.chrome.runtime.lastError = undefined;
        });

        const result = listener({ type: 'OPEN_WEB_STORE_FEEDBACK' }, {}, mockSendResponse);

        expect(mockSendResponse).toHaveBeenCalledWith({
            success: false,
            errorCode: 'tab_create_failed'
        });
        expect(result).toBe(true);
    });

    it('should surface a tab focus failure when the active tab cannot be focused', () => {
        global.chrome.tabs.query.mockImplementationOnce((queryInfo, cb) => {
            cb([
                { id: 21, url: 'https://notebooklm.google.com/notebook/abc', windowId: 5 }
            ]);
        });
        global.chrome.tabs.update.mockImplementationOnce((tabId, updateInfo, cb) => {
            global.chrome.runtime.lastError = { message: 'tab focus failed' };
            cb({ id: tabId, url: 'https://notebooklm.google.com/notebook/abc' });
            global.chrome.runtime.lastError = undefined;
        });

        const result = listener({
            type: 'OPEN_OR_FOCUS_NOTEBOOKLM',
            currentTabId: 12,
            currentContext: 'external'
        }, {}, mockSendResponse);

        expect(mockSendResponse).toHaveBeenCalledWith({
            success: false,
            errorCode: 'tab_focus_failed'
        });
        expect(result).toBe(true);
    });

    it('should surface a window focus failure when the tab is activated but the window cannot focus', () => {
        global.chrome.tabs.query.mockImplementationOnce((queryInfo, cb) => {
            cb([
                { id: 21, url: 'https://notebooklm.google.com/notebook/abc', windowId: 5 }
            ]);
        });
        global.chrome.tabs.update.mockImplementationOnce((tabId, updateInfo, cb) => {
            cb({ id: tabId, url: 'https://notebooklm.google.com/notebook/abc' });
        });
        global.chrome.windows.update.mockImplementationOnce((windowId, updateInfo, cb) => {
            global.chrome.runtime.lastError = { message: 'window focus failed' };
            cb();
            global.chrome.runtime.lastError = undefined;
        });

        const result = listener({
            type: 'OPEN_OR_FOCUS_NOTEBOOKLM',
            currentTabId: 12,
            currentContext: 'external'
        }, {}, mockSendResponse);

        expect(mockSendResponse).toHaveBeenCalledWith({
            success: false,
            errorCode: 'window_focus_failed'
        });
        expect(result).toBe(true);
    });

    it('should surface a tab create failure when NotebookLM cannot open a home tab', () => {
        global.chrome.tabs.query.mockImplementationOnce((queryInfo, cb) => {
            cb([]);
        });
        global.chrome.tabs.create.mockImplementationOnce((createProperties, cb) => {
            global.chrome.runtime.lastError = { message: 'tab create failed' };
            cb(null);
            global.chrome.runtime.lastError = undefined;
        });

        const result = listener({
            type: 'OPEN_OR_FOCUS_NOTEBOOKLM',
            currentTabId: 12,
            currentContext: 'external'
        }, {}, mockSendResponse);

        expect(mockSendResponse).toHaveBeenCalledWith({
            success: false,
            errorCode: 'tab_create_failed'
        });
        expect(result).toBe(true);
    });

    it('should open a new NotebookLM home tab when the current tab is the only home tab', () => {
        global.chrome.tabs.query.mockImplementationOnce((queryInfo, cb) => {
            cb([
                { id: 12, url: 'https://notebooklm.google.com/', windowId: 3 }
            ]);
        });

        const result = listener({
            type: 'OPEN_OR_FOCUS_NOTEBOOKLM',
            currentTabId: 12,
            currentContext: 'notebook-home'
        }, {}, mockSendResponse);

        expect(global.chrome.tabs.update).not.toHaveBeenCalled();
        expect(global.chrome.tabs.create).toHaveBeenCalledWith(
            { url: 'https://notebooklm.google.com/' },
            expect.any(Function)
        );
        expect(mockSendResponse).toHaveBeenCalledWith({
            success: true,
            action: 'opened-new-home',
            tabId: 99,
            url: 'https://notebooklm.google.com/'
        });
        expect(result).toBe(true);
    });

    it('should focus an existing NotebookLM home tab from an external page when no notebook tab exists', () => {
        global.chrome.tabs.query.mockImplementationOnce((queryInfo, cb) => {
            cb([
                { id: 21, url: 'https://notebooklm.google.com/', windowId: 8 }
            ]);
        });
        global.chrome.tabs.update.mockImplementationOnce((tabId, updateInfo, cb) => {
            if (cb) cb({ id: tabId, url: 'https://notebooklm.google.com/' });
        });

        const result = listener({
            type: 'OPEN_OR_FOCUS_NOTEBOOKLM',
            currentTabId: 5,
            currentContext: 'external'
        }, {}, mockSendResponse);

        expect(global.chrome.tabs.update).toHaveBeenCalledWith(
            21,
            { active: true },
            expect.any(Function)
        );
        expect(mockSendResponse).toHaveBeenCalledWith({
            success: true,
            action: 'focused-existing-home',
            tabId: 21,
            url: 'https://notebooklm.google.com/'
        });
        expect(result).toBe(true);
    });

    it('should open NotebookLM when no matching tab exists', () => {
        global.chrome.tabs.query.mockImplementationOnce((queryInfo, cb) => {
            cb([]);
        });

        const result = listener({
            type: 'OPEN_OR_FOCUS_NOTEBOOKLM',
            currentTabId: 5,
            currentContext: 'external'
        }, {}, mockSendResponse);

        expect(global.chrome.tabs.create).toHaveBeenCalledWith(
            { url: 'https://notebooklm.google.com/' },
            expect.any(Function)
        );
        expect(mockSendResponse).toHaveBeenCalledWith({
            success: true,
            action: 'opened-new-home',
            tabId: 99,
            url: 'https://notebooklm.google.com/'
        });
        expect(result).toBe(true);
    });
});

describe('hasRestorableStateSnapshot recognizes state.root (v5)', () => {
    let hasRestorableStateSnapshot;
    beforeEach(() => {
        jest.resetModules();
        global.chrome = {
            runtime: {
                id: 'abcdefghijklmnopabcdefghijklmnop',
                onMessage: { addListener: jest.fn() },
                getManifest: jest.fn(() => ({})),
                lastError: undefined
            },
            tabs: {
                query: jest.fn(),
                update: jest.fn(),
                sendMessage: jest.fn(),
                create: jest.fn()
            },
            windows: { update: jest.fn() },
            storage: { local: { set: jest.fn(), get: jest.fn() } }
        };
        ({ hasRestorableStateSnapshot } = require('../src/background/index.js'));
    });

    afterEach(() => {
        delete global.chrome;
    });

    it('treats a v5 snapshot with a non-empty state.root as restorable', () => {
        expect(hasRestorableStateSnapshot({ root: [{ type: 'source', key: 'a' }] })).toBe(true);
        expect(hasRestorableStateSnapshot({ root: [{ type: 'group', id: 'g1' }] })).toBe(true);
    });

    it('treats an empty state.root with no other content as not restorable', () => {
        expect(hasRestorableStateSnapshot({ root: [], ungrouped: [], groupsById: {}, sourceStateById: {} })).toBe(false);
    });

    it('still recognizes legacy v4 snapshots via state.groups', () => {
        expect(hasRestorableStateSnapshot({ groups: ['g1'] })).toBe(true);
    });
});

describe('appearance preference normalization', () => {
    let normalizePreferences;

    beforeEach(() => {
        global.chrome = {
            runtime: {
                id: 'abcdefghijklmnopabcdefghijklmnop',
                onMessage: { addListener: jest.fn() },
                getManifest: jest.fn(() => ({})),
                lastError: undefined
            },
            tabs: {
                query: jest.fn(),
                update: jest.fn(),
                sendMessage: jest.fn(),
                create: jest.fn()
            },
            windows: { update: jest.fn() },
            storage: { local: { set: jest.fn(), get: jest.fn() } }
        };
        jest.isolateModules(() => {
            ({ normalizePreferences } = require('../src/background/index.js'));
        });
    });

    afterEach(() => {
        delete global.chrome;
    });

    it('defaults appearance.hoverSpotlightEnabled to true when preferences are empty', () => {
        expect(normalizePreferences({}).appearance).toEqual({ hoverSpotlightEnabled: true });
    });

    it('defaults appearance.hoverSpotlightEnabled to true when appearance is null', () => {
        expect(normalizePreferences({ appearance: null }).appearance).toEqual({ hoverSpotlightEnabled: true });
    });

    it('defaults appearance.hoverSpotlightEnabled to true when appearance is not an object', () => {
        expect(normalizePreferences({ appearance: 'yes' }).appearance).toEqual({ hoverSpotlightEnabled: true });
    });

    it('returns false only when hoverSpotlightEnabled is strictly false', () => {
        expect(normalizePreferences({ appearance: { hoverSpotlightEnabled: false } }).appearance.hoverSpotlightEnabled).toBe(false);
    });

    it('returns true when hoverSpotlightEnabled is a non-boolean truthy/falsy value (default-true fallback)', () => {
        expect(normalizePreferences({ appearance: { hoverSpotlightEnabled: 0 } }).appearance.hoverSpotlightEnabled).toBe(true);
        expect(normalizePreferences({ appearance: { hoverSpotlightEnabled: '' } }).appearance.hoverSpotlightEnabled).toBe(true);
        expect(normalizePreferences({ appearance: { hoverSpotlightEnabled: 'no' } }).appearance.hoverSpotlightEnabled).toBe(true);
        expect(normalizePreferences({ appearance: { hoverSpotlightEnabled: undefined } }).appearance.hoverSpotlightEnabled).toBe(true);
    });

    it('returns true when hoverSpotlightEnabled is strictly true', () => {
        expect(normalizePreferences({ appearance: { hoverSpotlightEnabled: true } }).appearance.hoverSpotlightEnabled).toBe(true);
    });
});

describe('mergePreferences deep-merges appearance', () => {
    let mergePreferences;

    beforeEach(() => {
        global.chrome = {
            runtime: {
                id: 'abcdefghijklmnopabcdefghijklmnop',
                onMessage: { addListener: jest.fn() },
                getManifest: jest.fn(() => ({})),
                lastError: undefined
            },
            tabs: {
                query: jest.fn(),
                update: jest.fn(),
                sendMessage: jest.fn(),
                create: jest.fn()
            },
            windows: { update: jest.fn() },
            storage: { local: { set: jest.fn(), get: jest.fn() } }
        };
        jest.isolateModules(() => {
            ({ mergePreferences } = require('../src/background/index.js'));
        });
    });

    afterEach(() => {
        delete global.chrome;
    });

    it('preserves existing appearance fields when partial appearance is set', () => {
        const merged = mergePreferences(
            { appearance: { hoverSpotlightEnabled: false } },
            { appearance: {} }
        );
        expect(merged.appearance.hoverSpotlightEnabled).toBe(false);
    });

    it('overwrites hoverSpotlightEnabled when explicitly provided', () => {
        const merged = mergePreferences(
            { appearance: { hoverSpotlightEnabled: true } },
            { appearance: { hoverSpotlightEnabled: false } }
        );
        expect(merged.appearance.hoverSpotlightEnabled).toBe(false);
    });

    it('does not touch appearance when next has no appearance key', () => {
        const merged = mergePreferences(
            { appearance: { hoverSpotlightEnabled: false } },
            { developerModeEnabled: true }
        );
        expect(merged.appearance.hoverSpotlightEnabled).toBe(false);
        expect(merged.developerModeEnabled).toBe(true);
    });

    it('treats non-object appearance as empty object (does not throw)', () => {
        const merged = mergePreferences(
            { appearance: { hoverSpotlightEnabled: false } },
            { appearance: null }
        );
        expect(merged.appearance.hoverSpotlightEnabled).toBe(false);
    });
});

describe('dragMode preference', () => {
    let normalizePreferences;
    let mergePreferences;

    beforeEach(() => {
        global.chrome = {
            runtime: {
                id: 'abcdefghijklmnopabcdefghijklmnop',
                onMessage: { addListener: jest.fn() },
                getManifest: jest.fn(() => ({})),
                lastError: undefined
            },
            tabs: { query: jest.fn(), update: jest.fn(), sendMessage: jest.fn(), create: jest.fn() },
            windows: { update: jest.fn() },
            storage: { local: { set: jest.fn(), get: jest.fn() } }
        };
        jest.isolateModules(() => {
            ({ normalizePreferences, mergePreferences } = require('../src/background/index.js'));
        });
    });

    afterEach(() => {
        delete global.chrome;
    });

    it('normalizeDragMode falls back to classic for anything but reflow', () => {
        const { normalizeDragMode } = require('../src/utils/preference-normalizers.js');
        expect(normalizeDragMode('reflow')).toBe('reflow');
        expect(normalizeDragMode('classic')).toBe('classic');
        expect(normalizeDragMode('bogus')).toBe('classic');
        expect(normalizeDragMode(undefined)).toBe('classic');
        expect(normalizeDragMode(null)).toBe('classic');
    });

    it('defaults dragMode to classic when unset', () => {
        expect(normalizePreferences({}).dragMode).toBe('classic');
    });

    it('normalizes dragMode through normalizePreferences', () => {
        expect(normalizePreferences({ dragMode: 'reflow' }).dragMode).toBe('reflow');
        expect(normalizePreferences({ dragMode: 'bogus' }).dragMode).toBe('classic');
        expect(normalizePreferences({ dragMode: 42 }).dragMode).toBe('classic');
    });

    it('merges dragMode when provided, otherwise leaves it untouched', () => {
        expect(mergePreferences({}, { dragMode: 'reflow' }).dragMode).toBe('reflow');
        expect(mergePreferences({ dragMode: 'reflow' }, { dragMode: 'bogus' }).dragMode).toBe('classic');
        const merged = mergePreferences({ dragMode: 'reflow' }, { developerModeEnabled: true });
        expect(merged.dragMode).toBe('reflow');
        expect(merged.developerModeEnabled).toBe(true);
    });
});
