(function () {
    'use strict';

    if (
        !globalThis.NSM_PREFERENCE_NORMALIZERS
        && typeof require !== 'undefined'
    ) {
        require('../utils/preference-normalizers.js');
    }

    /**
     * Owns the complete global preference lifecycle for the content script.
     * The module normalizes runtime responses, tracks verified load state,
     * deduplicates the initial load, and rolls back optimistic saves on failure.
     * It deliberately has no dependency on developer logging or notebook state.
     */
    function createContentPreferences(context = {}) {
        const ctx = context && typeof context === 'object' ? context : {};
        const chromeApi = ctx.chrome ?? globalThis.chrome;
        const {
            normalizePreferenceVersion,
            normalizeWhatsNewSeenVersion,
            normalizeHistoryRetentionLimit,
            normalizeLanguageOverride,
            normalizeDragMode,
            normalizeCommandShortcutId,
            normalizeCommandShortcutCombo,
            normalizeCommandShortcuts,
            normalizeVisibleQuickViewKinds,
            normalizeAppearancePreferences
        } = globalThis.NSM_PREFERENCE_NORMALIZERS;

        let developerModeEnabled = false;
        let welcomeOnboardingSeenVersion = 0;
        let whatsNewSeenVersion = '';
        let preferenceUsageState = {
            hasExistingPluginData: false,
            hasStoredPreferences: false
        };
        let historyRetentionLimit = normalizeHistoryRetentionLimit();
        let languageOverride = normalizeLanguageOverride();
        let commandShortcuts = normalizeCommandShortcuts();
        let visibleQuickViewKinds = normalizeVisibleQuickViewKinds();
        let appearancePreferences = normalizeAppearancePreferences();
        let dragMode = normalizeDragMode();
        let preferencesLoadStatus = 'idle';
        let preferencesLoadPromise = null;
        let nextPreferenceOperationId = 1;
        let latestAppliedPreferenceOperationId = 0;
        let latestPreferenceLoadOperationId = 0;
        let latestCompleteSaveSnapshotOperationId = 0;
        let minimumValidPreferenceOperationId = 0;
        let confirmedPreferenceState = normalizePreferenceState();
        const pendingPreferenceMutations = new Map();
        const confirmedPreferenceMutations = new Map();
        const PREFERENCE_STATE_FIELDS = [
            'developerModeEnabled',
            'welcomeOnboardingSeenVersion',
            'whatsNewSeenVersion',
            'historyRetentionLimit',
            'languageOverride',
            'commandShortcuts',
            'visibleQuickViewKinds',
            'appearancePreferences',
            'dragMode'
        ];
        let latestAppliedOperationIdByField
            = createPreferenceFieldOperationIds();

        function sendRuntimeMessage(message) {
            if (!chromeApi?.runtime?.sendMessage) {
                return Promise.resolve({
                    success: false,
                    errorCode: 'runtime_unavailable'
                });
            }

            return new Promise((resolve) => {
                try {
                    chromeApi.runtime.sendMessage(message, (response) => {
                        if (chromeApi.runtime.lastError) {
                            resolve({
                                success: false,
                                errorCode: 'runtime_message_error'
                            });
                            return;
                        }
                        resolve(response || {
                            success: false,
                            errorCode: 'empty_response'
                        });
                    });
                } catch (error) {
                    resolve({
                        success: false,
                        errorCode: 'runtime_exception'
                    });
                }
            });
        }

        function normalizePreferenceState(preferences = {}) {
            return {
                developerModeEnabled: Boolean(
                    preferences?.developerModeEnabled
                ),
                welcomeOnboardingSeenVersion: normalizePreferenceVersion(
                    preferences?.welcomeOnboardingSeenVersion
                ),
                whatsNewSeenVersion: normalizeWhatsNewSeenVersion(
                    preferences?.whatsNewSeenVersion
                ),
                historyRetentionLimit: normalizeHistoryRetentionLimit(
                    preferences?.historyRetentionLimit
                ),
                languageOverride: normalizeLanguageOverride(
                    preferences?.languageOverride
                ),
                commandShortcuts: normalizeCommandShortcuts(
                    preferences?.commandShortcuts
                ),
                visibleQuickViewKinds: normalizeVisibleQuickViewKinds(
                    preferences?.visibleQuickViewKinds
                ),
                appearancePreferences: normalizeAppearancePreferences(
                    preferences?.appearance
                        ?? preferences?.appearancePreferences
                ),
                dragMode: normalizeDragMode(preferences?.dragMode)
            };
        }

        function createPreferenceFieldOperationIds(operationId = 0) {
            return Object.fromEntries(PREFERENCE_STATE_FIELDS.map(
                (field) => [field, operationId]
            ));
        }

        function clonePreferenceState(state = {}) {
            return {
                ...state,
                commandShortcuts: cloneCommandShortcuts(
                    state.commandShortcuts
                ),
                visibleQuickViewKinds: [
                    ...(state.visibleQuickViewKinds || [])
                ],
                appearancePreferences: {
                    ...(state.appearancePreferences || {})
                }
            };
        }

        function cloneEffectivePreferencePatch(patch = {}) {
            const clonedPatch = { ...patch };
            if (Object.prototype.hasOwnProperty.call(
                patch,
                'commandShortcuts'
            )) {
                clonedPatch.commandShortcuts = cloneCommandShortcuts(
                    patch.commandShortcuts
                );
            }
            if (Object.prototype.hasOwnProperty.call(
                patch,
                'visibleQuickViewKinds'
            )) {
                clonedPatch.visibleQuickViewKinds = [
                    ...(patch.visibleQuickViewKinds || [])
                ];
            }
            if (Object.prototype.hasOwnProperty.call(
                patch,
                'appearancePreferences'
            )) {
                clonedPatch.appearancePreferences = {
                    ...(patch.appearancePreferences || {})
                };
            }
            return clonedPatch;
        }

        function clonePreferenceMutation(mutation = {}) {
            return {
                effectivePatch: cloneEffectivePreferencePatch(
                    mutation.effectivePatch
                ),
                commandShortcutDelta: mutation.commandShortcutDelta
                    ? Object.assign({}, mutation.commandShortcutDelta)
                    : null
            };
        }

        function applyCommandShortcutDelta(shortcuts, delta) {
            const mergedShortcuts = cloneCommandShortcuts(shortcuts);
            Object.entries(delta || {}).forEach(([rawId, rawShortcut]) => {
                const id = normalizeCommandShortcutId(rawId);
                if (!id) return;
                const shortcut = normalizeCommandShortcutCombo(rawShortcut);
                if (!shortcut) {
                    delete mergedShortcuts[id];
                    return;
                }
                Object.keys(mergedShortcuts).forEach((existingId) => {
                    if (
                        existingId !== id
                        && mergedShortcuts[existingId] === shortcut
                    ) {
                        delete mergedShortcuts[existingId];
                    }
                });
                mergedShortcuts[id] = shortcut;
            });
            return mergedShortcuts;
        }

        function applyPreferenceMutationToState(
            nextState,
            mutation,
            operationId
        ) {
            const effectivePatch = cloneEffectivePreferencePatch(
                mutation.effectivePatch
            );
            Object.entries(effectivePatch).forEach(([field, value]) => {
                if (
                    field === 'commandShortcuts'
                    && mutation.commandShortcutDelta
                ) {
                    return;
                }
                if (
                    operationId
                    > (latestAppliedOperationIdByField[field] || 0)
                ) {
                    nextState[field] = value;
                }
            });
            if (
                mutation.commandShortcutDelta
                && operationId
                    > latestAppliedOperationIdByField.commandShortcuts
            ) {
                nextState.commandShortcuts = applyCommandShortcutDelta(
                    nextState.commandShortcuts,
                    mutation.commandShortcutDelta
                );
            }
        }

        function applyPreferenceState(nextState) {
            const normalizedState = clonePreferenceState(nextState);
            developerModeEnabled = normalizedState.developerModeEnabled;
            welcomeOnboardingSeenVersion
                = normalizedState.welcomeOnboardingSeenVersion;
            whatsNewSeenVersion = normalizedState.whatsNewSeenVersion;
            historyRetentionLimit = normalizedState.historyRetentionLimit;
            languageOverride = normalizedState.languageOverride;
            commandShortcuts = normalizedState.commandShortcuts;
            visibleQuickViewKinds = normalizedState.visibleQuickViewKinds;
            appearancePreferences = normalizedState.appearancePreferences;
            dragMode = normalizedState.dragMode;
        }

        function recomputeEffectivePreferences() {
            const nextState = clonePreferenceState(confirmedPreferenceState);
            const activeMutations = new Map(confirmedPreferenceMutations);
            pendingPreferenceMutations.forEach((mutation, operationId) => {
                activeMutations.set(operationId, mutation);
            });
            [...activeMutations.entries()]
                .sort(([leftId], [rightId]) => leftId - rightId)
                .forEach(([operationId, mutation]) => {
                    applyPreferenceMutationToState(
                        nextState,
                        mutation,
                        operationId
                    );
                });
            applyPreferenceState(nextState);
        }

        function pruneConfirmedPreferenceMutations() {
            confirmedPreferenceMutations.forEach((mutation, operationId) => {
                const remainingPatch = {};
                Object.entries(mutation.effectivePatch || {})
                    .forEach(([field, value]) => {
                        if (
                            operationId
                            > (latestAppliedOperationIdByField[field] || 0)
                        ) {
                            remainingPatch[field] = value;
                        }
                    });
                if (Object.keys(remainingPatch).length === 0) {
                    confirmedPreferenceMutations.delete(operationId);
                    return;
                }
                confirmedPreferenceMutations.set(operationId, {
                    effectivePatch: remainingPatch,
                    commandShortcutDelta: Object.prototype.hasOwnProperty.call(
                        remainingPatch,
                        'commandShortcuts'
                    )
                        ? mutation.commandShortcutDelta
                        : null
                });
            });
        }

        function applyConfirmedPreferenceSnapshot(
            preferences,
            operationId,
            authoritativeFields = PREFERENCE_STATE_FIELDS
        ) {
            const normalizedState = normalizePreferenceState(preferences);
            const nextState = clonePreferenceState(confirmedPreferenceState);
            const authoritativeFieldSet = new Set(authoritativeFields);
            PREFERENCE_STATE_FIELDS.forEach((field) => {
                if (
                    operationId
                    >= (latestAppliedOperationIdByField[field] || 0)
                ) {
                    nextState[field] = normalizedState[field];
                    if (authoritativeFieldSet.has(field)) {
                        latestAppliedOperationIdByField[field] = operationId;
                    }
                }
            });
            confirmedPreferenceState = nextState;
            pruneConfirmedPreferenceMutations();
            recomputeEffectivePreferences();
        }

        function applyLoadedPreferenceSnapshot(preferences, operationId) {
            if (operationId < latestCompleteSaveSnapshotOperationId) {
                return false;
            }
            applyConfirmedPreferenceSnapshot(preferences, operationId);
            return true;
        }

        function confirmPreferenceMutation(
            operationId,
            effectivePatch,
            nextPreferences
        ) {
            const pendingMutation = pendingPreferenceMutations.get(operationId);
            confirmedPreferenceMutations.set(
                operationId,
                clonePreferenceMutation(pendingMutation || {
                    effectivePatch,
                    commandShortcutDelta: Object.prototype.hasOwnProperty.call(
                        nextPreferences || {},
                        'commandShortcuts'
                    )
                        ? nextPreferences.commandShortcuts
                        : null
                })
            );
            recomputeEffectivePreferences();
        }

        function applyLoadedPreferenceUsageState(usageState = {}) {
            preferenceUsageState = {
                hasExistingPluginData: Boolean(
                    usageState?.hasExistingPluginData
                ),
                hasStoredPreferences: Boolean(
                    usageState?.hasStoredPreferences
                )
            };
        }

        function hasCompletePreferenceFields(preferences) {
            if (
                !preferences
                || typeof preferences !== 'object'
                || Array.isArray(preferences)
            ) {
                return false;
            }
            const hasAllFields = [
                'developerModeEnabled',
                'welcomeOnboardingSeenVersion',
                'whatsNewSeenVersion',
                'historyRetentionLimit',
                'languageOverride',
                'dragMode',
                'commandShortcuts',
                'visibleQuickViewKinds',
                'appearance'
            ].every((key) => Object.prototype.hasOwnProperty.call(
                preferences,
                key
            ));
            return hasAllFields;
        }

        function hasCompleteNormalizedPreferences(preferences) {
            if (!hasCompletePreferenceFields(preferences)) return false;
            return (
                typeof preferences.developerModeEnabled === 'boolean'
                && preferences.welcomeOnboardingSeenVersion
                    === normalizePreferenceVersion(
                        preferences.welcomeOnboardingSeenVersion
                    )
                && preferences.whatsNewSeenVersion
                    === normalizeWhatsNewSeenVersion(
                        preferences.whatsNewSeenVersion
                    )
                && preferences.historyRetentionLimit
                    === normalizeHistoryRetentionLimit(
                        preferences.historyRetentionLimit
                    )
                && preferences.languageOverride
                    === normalizeLanguageOverride(
                        preferences.languageOverride
                    )
                && preferences.dragMode
                    === normalizeDragMode(preferences.dragMode)
                && JSON.stringify(preferences.commandShortcuts)
                    === JSON.stringify(normalizeCommandShortcuts(
                        preferences.commandShortcuts
                    ))
                && JSON.stringify(preferences.visibleQuickViewKinds)
                    === JSON.stringify(normalizeVisibleQuickViewKinds(
                        preferences.visibleQuickViewKinds
                    ))
                && JSON.stringify(preferences.appearance)
                    === JSON.stringify(normalizeAppearancePreferences(
                        preferences.appearance
                    ))
            );
        }

        async function loadDeveloperPreferences() {
            const operationId = nextPreferenceOperationId++;
            const statusBeforeLoad = preferencesLoadStatus;
            latestPreferenceLoadOperationId = operationId;
            preferencesLoadStatus = 'loading';
            try {
                const response = await sendRuntimeMessage({
                    type: 'LOAD_PREFERENCES'
                });
                if (operationId < latestAppliedPreferenceOperationId) {
                    if (
                        response?.success === true
                        && response.preferences
                        && typeof response.preferences === 'object'
                    ) {
                        applyLoadedPreferenceSnapshot(
                            response.preferences,
                            operationId
                        );
                    }
                    if (
                        latestPreferenceLoadOperationId === operationId
                        && preferencesLoadStatus === 'loading'
                    ) {
                        preferencesLoadStatus = statusBeforeLoad === 'loaded'
                            ? 'loaded'
                            : 'failed';
                    }
                    return developerModeEnabled;
                }
                if (
                    response?.success !== true
                    || !response.preferences
                    || typeof response.preferences !== 'object'
                ) {
                    if (latestPreferenceLoadOperationId === operationId) {
                        preferencesLoadStatus = 'failed';
                    }
                    return developerModeEnabled;
                }
                applyLoadedPreferenceSnapshot(
                    response.preferences,
                    operationId
                );
                applyLoadedPreferenceUsageState(response.usageState);
                latestAppliedPreferenceOperationId = operationId;
                if (latestPreferenceLoadOperationId === operationId) {
                    preferencesLoadStatus = 'loaded';
                }
            } catch (error) {
                if (
                    operationId >= latestAppliedPreferenceOperationId
                    && latestPreferenceLoadOperationId === operationId
                ) {
                    preferencesLoadStatus = 'failed';
                }
            }
            return developerModeEnabled;
        }

        function ensureDeveloperPreferencesLoaded() {
            if (!preferencesLoadPromise) {
                preferencesLoadPromise = loadDeveloperPreferences();
            }
            return preferencesLoadPromise;
        }

        async function savePreferences(
            nextPreferences = {},
            operationId,
            effectivePatch = {}
        ) {
            const response = await sendRuntimeMessage({
                type: 'SAVE_PREFERENCES',
                preferences: nextPreferences
            });
            if (response?.success !== true) {
                throw new Error(response?.errorCode || 'runtime_failure');
            }
            if (operationId < minimumValidPreferenceOperationId) {
                return response;
            }

            const isLatestSuccessfulOperation
                = operationId >= latestAppliedPreferenceOperationId;
            latestAppliedPreferenceOperationId = Math.max(
                latestAppliedPreferenceOperationId,
                operationId
            );
            if (hasCompletePreferenceFields(response.preferences)) {
                latestCompleteSaveSnapshotOperationId = Math.max(
                    latestCompleteSaveSnapshotOperationId,
                    operationId
                );
                applyConfirmedPreferenceSnapshot(
                    response.preferences,
                    operationId,
                    Object.keys(effectivePatch)
                );
                if (
                    isLatestSuccessfulOperation
                    && hasCompleteNormalizedPreferences(response.preferences)
                ) {
                    preferencesLoadStatus = 'loaded';
                }
            } else {
                confirmPreferenceMutation(
                    operationId,
                    effectivePatch,
                    nextPreferences
                );
            }
            if (response.usageState) {
                applyLoadedPreferenceUsageState(response.usageState);
            } else {
                preferenceUsageState = {
                    hasExistingPluginData: true,
                    hasStoredPreferences: true
                };
            }
            return response;
        }

        async function runPreferenceMutation(
            nextPreferences,
            effectivePatch
        ) {
            const operationId = nextPreferenceOperationId++;
            pendingPreferenceMutations.set(operationId, {
                effectivePatch: cloneEffectivePreferencePatch(effectivePatch),
                commandShortcutDelta: Object.prototype.hasOwnProperty.call(
                    nextPreferences || {},
                    'commandShortcuts'
                )
                    ? Object.assign({}, nextPreferences.commandShortcuts)
                    : null
            });
            recomputeEffectivePreferences();
            try {
                await savePreferences(
                    nextPreferences,
                    operationId,
                    effectivePatch
                );
            } finally {
                pendingPreferenceMutations.delete(operationId);
                recomputeEffectivePreferences();
            }
        }

        function cloneCommandShortcuts(shortcuts = commandShortcuts) {
            return Object.assign(
                {},
                normalizeCommandShortcuts(shortcuts)
            );
        }

        async function setDeveloperModeEnabled(enabled) {
            const nextValue = Boolean(enabled);
            await runPreferenceMutation(
                { developerModeEnabled: nextValue },
                { developerModeEnabled: nextValue }
            );
            return developerModeEnabled;
        }

        async function setWelcomeOnboardingSeenVersion(version) {
            const nextValue = normalizePreferenceVersion(version);
            await runPreferenceMutation(
                { welcomeOnboardingSeenVersion: nextValue },
                { welcomeOnboardingSeenVersion: nextValue }
            );
            return welcomeOnboardingSeenVersion;
        }

        async function setWhatsNewSeenVersion(version) {
            const nextValue = normalizeWhatsNewSeenVersion(version);
            await runPreferenceMutation(
                { whatsNewSeenVersion: nextValue },
                { whatsNewSeenVersion: nextValue }
            );
            return whatsNewSeenVersion;
        }

        async function setOnboardingModalSeenVersions(nextVersions = {}) {
            const nextPreferences = {};

            if (Object.prototype.hasOwnProperty.call(
                nextVersions || {},
                'welcomeOnboardingSeenVersion'
            )) {
                nextPreferences.welcomeOnboardingSeenVersion
                    = normalizePreferenceVersion(
                        nextVersions.welcomeOnboardingSeenVersion
                    );
            }
            if (Object.prototype.hasOwnProperty.call(
                nextVersions || {},
                'whatsNewSeenVersion'
            )) {
                nextPreferences.whatsNewSeenVersion
                    = normalizeWhatsNewSeenVersion(
                        nextVersions.whatsNewSeenVersion
                    );
            }

            await runPreferenceMutation(
                nextPreferences,
                nextPreferences
            );

            return {
                welcomeOnboardingSeenVersion,
                whatsNewSeenVersion
            };
        }

        async function setHistoryRetentionLimit(limit) {
            const nextValue = normalizeHistoryRetentionLimit(limit);
            await runPreferenceMutation(
                { historyRetentionLimit: nextValue },
                { historyRetentionLimit: nextValue }
            );
            return historyRetentionLimit;
        }

        async function setLanguageOverride(locale) {
            const nextValue = normalizeLanguageOverride(locale);
            await runPreferenceMutation(
                { languageOverride: nextValue },
                { languageOverride: nextValue }
            );
            return languageOverride;
        }

        async function setCommandShortcut(commandId, shortcut) {
            const id = normalizeCommandShortcutId(commandId);
            if (!id) return '';
            const nextShortcuts = cloneCommandShortcuts();
            const normalizedShortcut = normalizeCommandShortcutCombo(shortcut);
            if (!normalizedShortcut) {
                delete nextShortcuts[id];
            } else {
                Object.keys(nextShortcuts).forEach((existingId) => {
                    if (
                        nextShortcuts[existingId] === normalizedShortcut
                        && existingId !== id
                    ) {
                        delete nextShortcuts[existingId];
                    }
                });
                nextShortcuts[id] = normalizedShortcut;
            }
            await runPreferenceMutation(
                {
                    commandShortcuts: {
                        [id]: normalizedShortcut
                    }
                },
                { commandShortcuts: nextShortcuts }
            );
            return getCommandShortcut(id);
        }

        async function setVisibleQuickViewKinds(kinds) {
            const nextKinds = normalizeVisibleQuickViewKinds(kinds);
            await runPreferenceMutation(
                { visibleQuickViewKinds: nextKinds },
                { visibleQuickViewKinds: nextKinds }
            );
            return getVisibleQuickViewKinds();
        }

        async function setHoverSpotlightEnabled(enabled) {
            const nextValue = enabled !== false;
            const nextAppearance = {
                ...appearancePreferences,
                hoverSpotlightEnabled: nextValue
            };
            await runPreferenceMutation(
                {
                    appearance: {
                        hoverSpotlightEnabled: nextValue
                    }
                },
                { appearancePreferences: nextAppearance }
            );
            return appearancePreferences.hoverSpotlightEnabled;
        }

        async function setDragMode(mode) {
            const nextValue = normalizeDragMode(mode);
            await runPreferenceMutation(
                { dragMode: nextValue },
                { dragMode: nextValue }
            );
            return dragMode;
        }

        function getPreferencesLoadStatus() {
            return preferencesLoadStatus;
        }

        function getDeveloperModeEnabled() {
            return developerModeEnabled;
        }

        function getWelcomeOnboardingSeenVersion() {
            return welcomeOnboardingSeenVersion;
        }

        function getWhatsNewSeenVersion() {
            return whatsNewSeenVersion;
        }

        function getPreferenceUsageState() {
            return Object.assign({}, preferenceUsageState);
        }

        function getHistoryRetentionLimit() {
            return historyRetentionLimit;
        }

        function getLanguageOverride() {
            return languageOverride;
        }

        function getCommandShortcuts() {
            return cloneCommandShortcuts();
        }

        function getCommandShortcut(commandId) {
            const id = normalizeCommandShortcutId(commandId);
            return id ? commandShortcuts[id] || '' : '';
        }

        function getVisibleQuickViewKinds() {
            return [...visibleQuickViewKinds];
        }

        function getHoverSpotlightEnabled() {
            return appearancePreferences.hoverSpotlightEnabled;
        }

        function getDragMode() {
            return dragMode;
        }

        function resetForTest() {
            confirmedPreferenceState = normalizePreferenceState();
            pendingPreferenceMutations.clear();
            confirmedPreferenceMutations.clear();
            applyPreferenceState(confirmedPreferenceState);
            preferenceUsageState = {
                hasExistingPluginData: false,
                hasStoredPreferences: false
            };
            preferencesLoadStatus = 'idle';
            preferencesLoadPromise = null;
            const barrierOperationId = nextPreferenceOperationId++;
            latestAppliedPreferenceOperationId = barrierOperationId;
            latestPreferenceLoadOperationId = barrierOperationId;
            latestCompleteSaveSnapshotOperationId = barrierOperationId;
            minimumValidPreferenceOperationId = barrierOperationId;
            latestAppliedOperationIdByField
                = createPreferenceFieldOperationIds(barrierOperationId);
        }

        return {
            loadDeveloperPreferences,
            ensureDeveloperPreferencesLoaded,
            getPreferencesLoadStatus,
            getDeveloperModeEnabled,
            setDeveloperModeEnabled,
            getWelcomeOnboardingSeenVersion,
            setWelcomeOnboardingSeenVersion,
            getWhatsNewSeenVersion,
            setWhatsNewSeenVersion,
            setOnboardingModalSeenVersions,
            getPreferenceUsageState,
            getHistoryRetentionLimit,
            setHistoryRetentionLimit,
            getLanguageOverride,
            setLanguageOverride,
            getCommandShortcuts,
            getCommandShortcut,
            setCommandShortcut,
            getVisibleQuickViewKinds,
            setVisibleQuickViewKinds,
            getHoverSpotlightEnabled,
            setHoverSpotlightEnabled,
            getDragMode,
            setDragMode,
            _resetForTest: resetForTest
        };
    }

    globalThis.NSM_CREATE_CONTENT_PREFERENCES = createContentPreferences;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentPreferences;
    }
})();
