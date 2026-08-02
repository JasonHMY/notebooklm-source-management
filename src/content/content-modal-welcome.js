(function () {
    'use strict';

    /**
     * createContentModalWelcome(deps) — 首次安装欢迎 modal(feature highlights + 反馈链接)。
     * 关闭即调 markWelcomeOnboardingSeen 落 storage,避免下次再弹。
     *
     * @param {Object} deps Required: el, getMessage, getShadowRoot (缺一抛错).
     *   Required for action: markWelcomeOnboardingSeen, openWebStoreFeedback.
     *   Optional: prepareModalOpen, closeManagedModal, bindModalKeyboardNavigation, requestAnimationFrame.
     * @returns {{ renderWelcomeModal, closeWelcomeModal, createWelcomeFeatureRow }}
     *   createWelcomeFeatureRow 是私用渲染 helper(icon + 标题 + 副本)外露给 Settings modal "Welcome again" 入口复用。
     */
    function createContentModalWelcome(deps = {}) {
        const ONBOARDING_EVENT_NAME = 'nsm:onboarding-success';
        const ONBOARDING_STEPS = [
            {
                id: 'create-folder',
                icon: 'create_new_folder',
                titleKey: 'ui_onboarding_step_create_folder_title',
                bodyKey: 'ui_onboarding_step_create_folder_body'
            },
            {
                id: 'move-source',
                icon: 'drive_file_move',
                titleKey: 'ui_onboarding_step_move_source_title',
                bodyKey: 'ui_onboarding_step_move_source_body'
            },
            {
                id: 'add-tag',
                icon: 'new_label',
                titleKey: 'ui_onboarding_step_add_tag_title',
                bodyKey: 'ui_onboarding_step_add_tag_body'
            }
        ];
        const onboardingStepIds = new Set(ONBOARDING_STEPS.map((step) => step.id));
        const completedOnboardingSteps = new Set();
        const {
            el,
            getMessage,
            getShadowRoot,
            prepareModalOpen,
            closeManagedModal,
            bindModalKeyboardNavigation,
            markWelcomeOnboardingSeen,
            openWebStoreFeedback,
            eventTarget = globalThis,
            requestAnimationFrame: rafFn = globalThis.requestAnimationFrame
        } = deps;

        if (typeof el !== 'function' || typeof getMessage !== 'function' || typeof getShadowRoot !== 'function') {
            throw new Error('GeminiNotebook-Source-Management: createContentModalWelcome requires el, getMessage and getShadowRoot.');
        }

        function closeWelcomeModal(options = {}) {
            return closeManagedModal('sp-welcome-modal', 'sp-welcome-backdrop', options);
        }

        function createWelcomeFeatureRow(iconName, titleKey, bodyKey) {
            return el('div', { className: 'sp-welcome-feature-row' }, [
                el('span', { className: 'google-symbols sp-welcome-feature-icon', 'aria-hidden': 'true' }, [iconName]),
                el('div', { className: 'sp-welcome-feature-copy' }, [
                    el('h4', { className: 'sp-welcome-feature-title' }, [getMessage(titleKey)]),
                    el('p', { className: 'sp-welcome-feature-body' }, [getMessage(bodyKey)])
                ])
            ]);
        }

        function createWelcomeChecklistRow(step) {
            const completed = completedOnboardingSteps.has(step.id);
            return el('div', {
                className: `sp-welcome-feature-row sp-welcome-checklist-row${completed ? ' is-complete' : ''}`,
                role: 'listitem',
                dataset: {
                    onboardingStep: step.id,
                    onboardingComplete: completed ? 'true' : 'false'
                }
            }, [
                el('span', {
                    className: 'google-symbols sp-welcome-feature-icon sp-welcome-checklist-icon',
                    'aria-hidden': 'true'
                }, [completed ? 'check_circle' : step.icon]),
                el('div', { className: 'sp-welcome-feature-copy' }, [
                    el('h4', { className: 'sp-welcome-feature-title' }, [getMessage(step.titleKey)]),
                    el('p', { className: 'sp-welcome-feature-body' }, [getMessage(step.bodyKey)])
                ])
            ]);
        }

        function syncRenderedChecklist() {
            const shadowRoot = getShadowRoot();
            const rows = Array.from(shadowRoot?.querySelectorAll?.('.sp-welcome-checklist-row') || []);
            rows.forEach((row) => {
                const stepId = String(row?.dataset?.onboardingStep || '');
                const completed = completedOnboardingSteps.has(stepId);
                row.dataset.onboardingComplete = completed ? 'true' : 'false';
                row.classList?.toggle?.('is-complete', completed);
                const icon = row.querySelector?.('.sp-welcome-checklist-icon');
                if (icon && completed) icon.textContent = 'check_circle';
            });
            return rows.length;
        }

        function recordOnboardingEvent(eventOrStep) {
            const stepId = String(
                typeof eventOrStep === 'string'
                    ? eventOrStep
                    : eventOrStep?.detail?.step
            );
            if (!onboardingStepIds.has(stepId)) return false;
            completedOnboardingSteps.add(stepId);
            syncRenderedChecklist();
            return true;
        }

        eventTarget?.addEventListener?.(ONBOARDING_EVENT_NAME, recordOnboardingEvent);

        function renderWelcomeModal(options = {}) {
            const shadowRoot = getShadowRoot();
            if (!shadowRoot || !el) return false;
            const markSeenOnClose = options.markSeenOnClose !== false;

            let hasMarkedSeen = false;
            const markSeenOnce = () => {
                if (!markSeenOnClose) return Promise.resolve(true);
                if (hasMarkedSeen) return Promise.resolve(true);
                hasMarkedSeen = true;
                return Promise.resolve(markWelcomeOnboardingSeen()).catch(() => false);
            };
            const closeAfterSeen = () => {
                markSeenOnce();
                closeWelcomeModal();
            };

            prepareModalOpen('sp-welcome-modal', 'sp-welcome-backdrop');

            const backdrop = el('div', { className: 'sp-overlay-backdrop', id: 'sp-welcome-backdrop' });
            const modal = el('div', {
                className: 'sp-folder-modal sp-welcome-modal',
                id: 'sp-welcome-modal',
                role: 'dialog',
                'aria-modal': 'true',
                'aria-labelledby': 'sp-welcome-modal-title',
                tabindex: '-1'
            });
            const closeButton = el('button', {
                type: 'button',
                className: 'sp-icon-button sp-welcome-close-btn',
                'aria-label': getMessage('ui_welcome_close'),
                title: getMessage('ui_welcome_close')
            }, [
                el('span', { className: 'google-symbols', 'aria-hidden': 'true' }, ['close'])
            ]);
            const header = el('div', { className: 'sp-welcome-header' }, [
                el('div', { className: 'sp-welcome-brand-icon', 'aria-hidden': 'true' }, [
                    el('span', { className: 'google-symbols sp-welcome-brand-symbol' }, ['library_books'])
                ]),
                el('div', { className: 'sp-welcome-heading' }, [
                    el('h3', { className: 'sp-folder-modal-title sp-welcome-title', id: 'sp-welcome-modal-title' }, [
                        getMessage('ui_welcome_title')
                    ]),
                    el('p', { className: 'sp-welcome-subtitle' }, [
                        getMessage('ui_welcome_subtitle')
                    ])
                ]),
                closeButton
            ]);
            const content = el('div', { className: 'sp-folder-modal-content sp-welcome-content' }, [
                el('div', {
                    className: 'sp-welcome-feature-list sp-welcome-checklist',
                    role: 'list',
                    'aria-label': getMessage('ui_onboarding_checklist_title')
                }, ONBOARDING_STEPS.map(createWelcomeChecklistRow)),
                el('div', { className: 'sp-welcome-feedback-inline' }, [
                    el('span', { className: 'sp-welcome-feedback-copy' }, [
                        getMessage('ui_welcome_feedback_body')
                    ]),
                    el('button', { type: 'button', className: 'sp-welcome-feedback-link' }, [
                        getMessage('ui_welcome_feedback')
                    ])
                ])
            ]);
            const footer = el('div', { className: 'sp-folder-modal-footer sp-welcome-footer' }, [
                el('button', { type: 'button', className: 'sp-button sp-welcome-skip-btn' }, [
                    getMessage('ui_welcome_skip')
                ]),
                el('button', { type: 'button', className: 'sp-button sp-welcome-primary-btn sp-glare-hover' }, [
                    getMessage('ui_welcome_get_started')
                ])
            ]);

            modal.appendChild(header);
            modal.appendChild(content);
            modal.appendChild(footer);
            shadowRoot.appendChild(backdrop);
            shadowRoot.appendChild(modal);

            closeButton.addEventListener('click', closeAfterSeen);
            content.querySelector('.sp-welcome-feedback-link')?.addEventListener('click', () => {
                markSeenOnce();
                if (typeof openWebStoreFeedback === 'function') {
                    openWebStoreFeedback();
                }
                closeWelcomeModal();
            });
            footer.querySelector('.sp-welcome-skip-btn')?.addEventListener('click', closeAfterSeen);
            footer.querySelector('.sp-welcome-primary-btn')?.addEventListener('click', closeAfterSeen);
            backdrop.addEventListener('click', closeAfterSeen);

            const modalKeyboard = bindModalKeyboardNavigation(modal, {
                closeModal: closeAfterSeen,
                initialFocusTarget: () => modal.querySelector('.sp-welcome-primary-btn') || closeButton
            });
            if (typeof rafFn === 'function') {
                rafFn(() => {
                    backdrop.classList.add('visible');
                    modal.classList.add('visible');
                    modalKeyboard.focusInitial();
                });
            } else {
                backdrop.classList.add('visible');
                modal.classList.add('visible');
                modalKeyboard.focusInitial();
            }

            return true;
        }

        return {
            renderWelcomeModal,
            closeWelcomeModal,
            createWelcomeFeatureRow,
            recordOnboardingEvent,
            getCompletedOnboardingSteps: () => Array.from(completedOnboardingSteps)
        };
    }

    globalThis.NSM_CREATE_CONTENT_MODAL_WELCOME = createContentModalWelcome;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentModalWelcome;
    }
})();
