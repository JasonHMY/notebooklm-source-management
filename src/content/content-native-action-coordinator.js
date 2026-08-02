(function () {
    'use strict';

    /**
     * createContentNativeActionCoordinator(deps) — serializes native Notebook actions
     * and binds every asynchronous step to the project/manager instance that started it.
     *
     * The coordinator intentionally stores only stable source identity fields. It never
     * logs source titles or other user-controlled text.
     *
     * @param {Object} deps
     * @param {Function} [deps.getDocument]
     * @param {Function} [deps.getContext] Returns { projectId, managerInstanceToken }.
     * @param {Function} [deps.getHostElement] Defaults to document.body.
     * @param {Function} [deps.developerLog]
     * @returns {Object} Native action operation lifecycle helpers.
     */
    function createContentNativeActionCoordinator(deps = {}) {
        const getDocument = typeof deps.getDocument === 'function'
            ? deps.getDocument
            : () => (typeof document !== 'undefined' ? document : null);
        const getContext = typeof deps.getContext === 'function'
            ? deps.getContext
            : () => ({ projectId: '', managerInstanceToken: 0 });
        const getHostElement = typeof deps.getHostElement === 'function'
            ? deps.getHostElement
            : () => getDocument()?.body || null;
        const developerLog = typeof deps.developerLog === 'function'
            ? deps.developerLog
            : () => false;
        const hostClassName = String(
            deps.hostClassName || 'sources-plus-native-action-active'
        ).trim();
        const hostAttributeName = String(
            deps.hostAttributeName || 'data-nsm-native-action-active'
        ).trim();

        let activeOperation = null;
        let nextOperationId = 1;
        let nextStepId = 1;

        function normalizeContext(value = {}) {
            return {
                projectId: String(value?.projectId || ''),
                managerInstanceToken: String(value?.managerInstanceToken ?? '')
            };
        }

        function readCurrentContext() {
            try {
                return normalizeContext(getContext() || {});
            } catch (error) {
                return normalizeContext();
            }
        }

        function normalizeSourceIdentity(value = {}) {
            return {
                stableToken: String(value?.stableToken || ''),
                fingerprint: String(value?.fingerprint || ''),
                normalizedTitle: String(value?.normalizedTitle || '')
            };
        }

        function hasBoundSourceIdentity(value = {}) {
            const identity = normalizeSourceIdentity(value);
            return Boolean(
                identity.stableToken
                || identity.fingerprint
                || identity.normalizedTitle
            );
        }

        function doContextsMatch(first, second) {
            const left = normalizeContext(first);
            const right = normalizeContext(second);
            return (
                left.projectId === right.projectId
                && left.managerInstanceToken === right.managerInstanceToken
            );
        }

        function doSourceIdentitiesMatch(expected, actual) {
            const left = normalizeSourceIdentity(expected);
            const right = normalizeSourceIdentity(actual);
            if (left.stableToken) return left.stableToken === right.stableToken;
            if (left.fingerprint) return left.fingerprint === right.fingerprint;
            if (left.normalizedTitle) return left.normalizedTitle === right.normalizedTitle;
            return false;
        }

        function addOperationHostScope(operation) {
            const host = getHostElement();
            if (!host) return null;
            try {
                host.classList?.add?.(hostClassName);
                host.setAttribute?.(hostAttributeName, 'true');
                return host;
            } catch (error) {
                return null;
            }
        }

        function removeOperationHostScope(operation) {
            const host = operation?.hostElement || getHostElement();
            if (!host) return false;
            try {
                host.classList?.remove?.(hostClassName);
                host.removeAttribute?.(hostAttributeName);
                return true;
            } catch (error) {
                return false;
            }
        }

        function beginOperation(meta = {}) {
            if (activeOperation) {
                return {
                    ok: false,
                    reason: 'native_action_busy',
                    operation: null
                };
            }

            const action = String(meta.action || '').trim();
            const sourceKey = String(meta.sourceKey || '').trim();
            const sourceIdentity = normalizeSourceIdentity(meta.sourceIdentity);
            const isOuterBatchSession = action === 'batch-delete';
            if (
                !action
                || !sourceKey
                || (!isOuterBatchSession && !hasBoundSourceIdentity(sourceIdentity))
            ) {
                return {
                    ok: false,
                    reason: 'native_action_invalid',
                    operation: null
                };
            }

            const context = readCurrentContext();
            const operation = {
                operationId: `native-${nextOperationId}`,
                action,
                sourceKey,
                sourceIdentity,
                projectId: context.projectId,
                managerInstanceToken: context.managerInstanceToken,
                hostElement: null,
                stepBinding: null
            };
            nextOperationId += 1;
            activeOperation = operation;
            operation.hostElement = addOperationHostScope(operation);
            developerLog('debug', 'native_action', 'operation_started', {
                operationId: operation.operationId,
                action: operation.action,
                sourceKey: operation.sourceKey
            });
            return { ok: true, operation };
        }

        function bindOperationStep(operation, meta = {}) {
            const operationState = validateOperation(operation);
            if (!operationState.ok) return operationState;
            if (activeOperation.stepBinding) {
                return { ok: false, reason: 'native_action_busy', step: null };
            }
            const action = String(meta.action || '').trim();
            const sourceKey = String(meta.sourceKey || '').trim();
            const sourceIdentity = normalizeSourceIdentity(meta.sourceIdentity);
            if (!action || !sourceKey || !hasBoundSourceIdentity(sourceIdentity)) {
                return { ok: false, reason: 'native_action_invalid', step: null };
            }
            const step = {
                stepId: `native-step-${nextStepId++}`,
                action,
                sourceKey,
                sourceIdentity
            };
            activeOperation.stepBinding = step;
            return { ok: true, step };
        }

        function validateOperationStep(operation, expected = {}) {
            const operationState = validateOperation(operation);
            if (!operationState.ok) return operationState;
            const step = activeOperation?.stepBinding;
            if (!step) return { ok: false, reason: 'native_action_stale' };
            if (expected.action && String(expected.action) !== step.action) {
                return { ok: false, reason: 'native_action_stale' };
            }
            if (expected.sourceKey && String(expected.sourceKey) !== step.sourceKey) {
                return { ok: false, reason: 'native_action_source_changed' };
            }
            if (
                expected.sourceIdentity
                && !doSourceIdentitiesMatch(step.sourceIdentity, expected.sourceIdentity)
            ) {
                return { ok: false, reason: 'native_action_source_changed' };
            }
            return { ok: true, reason: '' };
        }

        function clearOperationStep(operation, step = null) {
            const operationState = validateOperation(operation);
            if (!operationState.ok || !activeOperation?.stepBinding) return false;
            if (
                step?.stepId
                && step.stepId !== activeOperation.stepBinding.stepId
            ) {
                return false;
            }
            activeOperation.stepBinding = null;
            return true;
        }

        function validateOperation(operation, expected = {}) {
            if (!operation || !activeOperation || operation.operationId !== activeOperation.operationId) {
                return { ok: false, reason: 'native_action_stale' };
            }
            if (!doContextsMatch(operation, readCurrentContext())) {
                return { ok: false, reason: 'native_action_context_changed' };
            }
            if (expected.action && String(expected.action) !== operation.action) {
                return { ok: false, reason: 'native_action_stale' };
            }
            if (expected.sourceKey && String(expected.sourceKey) !== operation.sourceKey) {
                return { ok: false, reason: 'native_action_source_changed' };
            }
            if (
                expected.sourceIdentity
                && !doSourceIdentitiesMatch(operation.sourceIdentity, expected.sourceIdentity)
            ) {
                return { ok: false, reason: 'native_action_source_changed' };
            }
            return { ok: true, reason: '' };
        }

        function endOperation(operation, reason = 'completed') {
            if (!operation || !activeOperation || operation.operationId !== activeOperation.operationId) {
                return false;
            }
            const completedOperation = activeOperation;
            activeOperation = null;
            removeOperationHostScope(completedOperation);
            developerLog('debug', 'native_action', 'operation_finished', {
                operationId: completedOperation.operationId,
                action: completedOperation.action,
                sourceKey: completedOperation.sourceKey,
                result: String(reason || 'completed')
            });
            return true;
        }

        function cancelActiveOperation(reason = 'native_action_cancelled') {
            if (!activeOperation) return false;
            return endOperation(activeOperation, reason);
        }

        async function runExclusive(meta, worker) {
            const beginResult = beginOperation(meta);
            if (!beginResult.ok) {
                return { ok: false, reason: beginResult.reason };
            }
            try {
                return await worker(beginResult.operation);
            } finally {
                endOperation(beginResult.operation);
            }
        }

        return {
            beginOperation,
            bindOperationStep,
            validateOperationStep,
            clearOperationStep,
            validateOperation,
            endOperation,
            cancelActiveOperation,
            teardown: cancelActiveOperation,
            runExclusive,
            getActiveOperation: () => activeOperation,
            isOperationActive: () => Boolean(activeOperation),
            normalizeContext,
            normalizeSourceIdentity,
            hasBoundSourceIdentity,
            doContextsMatch,
            doSourceIdentitiesMatch
        };
    }

    globalThis.NSM_CREATE_CONTENT_NATIVE_ACTION_COORDINATOR = createContentNativeActionCoordinator;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentNativeActionCoordinator;
    }
})();
