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
        const {
            el,
            getMessage,
            getShadowRoot,
            prepareModalOpen,
            closeManagedModal,
            bindModalKeyboardNavigation,
            markWelcomeOnboardingSeen,
            openWebStoreFeedback,
            requestAnimationFrame: rafFn = globalThis.requestAnimationFrame
        } = deps;

        if (typeof el !== 'function' || typeof getMessage !== 'function' || typeof getShadowRoot !== 'function') {
            throw new Error('NotebookLM Source Management: createContentModalWelcome requires el, getMessage and getShadowRoot.');
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

        function renderWelcomeModal() {
            const shadowRoot = getShadowRoot();
            if (!shadowRoot || !el) return false;

            let hasMarkedSeen = false;
            const markSeenOnce = () => {
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
                el('div', { className: 'sp-welcome-feature-list' }, [
                    createWelcomeFeatureRow('folder', 'ui_welcome_feature_organize_title', 'ui_welcome_feature_organize_body'),
                    createWelcomeFeatureRow('manage_search', 'ui_welcome_feature_find_title', 'ui_welcome_feature_find_body'),
                    createWelcomeFeatureRow('history', 'ui_welcome_feature_backup_title', 'ui_welcome_feature_backup_body')
                ]),
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
            createWelcomeFeatureRow
        };
    }

    globalThis.NSM_CREATE_CONTENT_MODAL_WELCOME = createContentModalWelcome;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentModalWelcome;
    }
})();
