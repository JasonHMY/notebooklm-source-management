describe('background.js message listener', () => {
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

    it('should log a warning and return early for an unauthorized sender', () => {
        const invalidSender = {
            tab: {
                url: 'https://example.com'
            }
        };

        listener({ type: 'SAVE_STATE' }, invalidSender, mockSendResponse);

        expect(console.warn).toHaveBeenCalledWith(
            'NotebookLM Source Management: Received message from unauthorized sender:',
            invalidSender
        );
        expect(global.chrome.storage.local.set).not.toHaveBeenCalled();
        expect(mockSendResponse).toHaveBeenCalledWith({
            success: false,
            errorCode: 'unauthorized_sender'
        });
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
            'NotebookLM Source Management: Received SAVE_STATE with invalid key:',
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
            'NotebookLM Source Management background save error:',
            global.chrome.runtime.lastError
        );
        expect(mockSendResponse).toHaveBeenCalledWith({
            success: false,
            errorCode: 'runtime_failure'
        });
        expect(result).toBe(true);
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
            'NotebookLM Source Management background save error:',
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
            'NotebookLM Source Management background load error:',
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
            'NotebookLM Source Management: Received LOAD_STATE with invalid key:',
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
            ['sourcesPlusHistory_123'],
            expect.any(Function)
        );
        expect(mockSendResponse).toHaveBeenCalledWith({
            success: true,
            history
        });
    });

    it('appends state history entries with de-duplication and a five entry limit', () => {
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
        const existing = [1, 2, 3, 4, 5].map(makeEntry);
        global.chrome.storage.local.get.mockImplementationOnce((keys, cb) => {
            cb({ sourcesPlusHistory_123: existing });
        });

        listener({
            type: 'APPEND_STATE_HISTORY',
            key: 'sourcesPlusHistory_123',
            entry: makeEntry(6)
        }, validSender, mockSendResponse);

        const savedHistory = global.chrome.storage.local.set.mock.calls[0][0].sourcesPlusHistory_123;
        expect(savedHistory).toHaveLength(5);
        expect(savedHistory.map((entry) => entry.id)).toEqual([
            'entry-6',
            'entry-1',
            'entry-2',
            'entry-3',
            'entry-4'
        ]);
        expect(mockSendResponse).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            history: savedHistory
        }));
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
