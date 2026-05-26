(function () {
    'use strict';

    function createContentModalWhatsNew(deps = {}) {
        const {
            el,
            getMessage,
            getShadowRoot,
            prepareModalOpen,
            closeManagedModal,
            bindModalKeyboardNavigation,
            markWhatsNewSeen,
            createWelcomeFeatureRow,
            requestAnimationFrame: rafFn = globalThis.requestAnimationFrame
        } = deps;

        if (typeof el !== 'function' || typeof getMessage !== 'function' || typeof getShadowRoot !== 'function') {
            throw new Error('NotebookLM Source Management: createContentModalWhatsNew requires el, getMessage and getShadowRoot.');
        }

        function closeWhatsNewModal(options = {}) {
            return closeManagedModal('sp-whats-new-modal', 'sp-whats-new-backdrop', options);
        }

        const featureRow = typeof createWelcomeFeatureRow === 'function'
            ? createWelcomeFeatureRow
            : (iconName, titleKey, bodyKey) => el('div', { className: 'sp-welcome-feature-row' }, [
                el('span', { className: 'google-symbols sp-welcome-feature-icon', 'aria-hidden': 'true' }, [iconName]),
                el('div', { className: 'sp-welcome-feature-copy' }, [
                    el('h4', { className: 'sp-welcome-feature-title' }, [getMessage(titleKey)]),
                    el('p', { className: 'sp-welcome-feature-body' }, [getMessage(bodyKey)])
                ])
            ]);

        function renderWhatsNewModal(options = {}) {
            const shadowRoot = getShadowRoot();
            if (!shadowRoot || !el) return false;
            const shouldMarkSeenOnClose = options?.markSeenOnClose !== false;

            let hasMarkedSeen = false;
            const markSeenOnce = () => {
                if (!shouldMarkSeenOnClose) return Promise.resolve(true);
                if (hasMarkedSeen) return Promise.resolve(true);
                hasMarkedSeen = true;
                return Promise.resolve(markWhatsNewSeen()).catch(() => false);
            };
            const closeAfterSeen = () => {
                markSeenOnce();
                closeWhatsNewModal();
            };

            prepareModalOpen('sp-whats-new-modal', 'sp-whats-new-backdrop');

            const backdrop = el('div', { className: 'sp-overlay-backdrop', id: 'sp-whats-new-backdrop' });
            const modal = el('div', {
                className: 'sp-folder-modal sp-welcome-modal sp-whats-new-modal',
                id: 'sp-whats-new-modal',
                role: 'dialog',
                'aria-modal': 'true',
                'aria-labelledby': 'sp-whats-new-modal-title',
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
                    el('span', { className: 'google-symbols sp-welcome-brand-symbol' }, ['new_releases'])
                ]),
                el('div', { className: 'sp-welcome-heading' }, [
                    el('h3', { className: 'sp-folder-modal-title sp-welcome-title', id: 'sp-whats-new-modal-title' }, [
                        getMessage('ui_whats_new_title')
                    ]),
                    el('p', { className: 'sp-welcome-subtitle' }, [
                        getMessage('ui_whats_new_subtitle')
                    ])
                ]),
                closeButton
            ]);
            const content = el('div', { className: 'sp-folder-modal-content sp-welcome-content' }, [
                el('div', { className: 'sp-welcome-feature-list' }, [
                    featureRow('drag_indicator', 'ui_whats_new_batch_drag_title', 'ui_whats_new_batch_drag_body'),
                    featureRow('expand_more', 'ui_whats_new_hover_expand_title', 'ui_whats_new_hover_expand_body'),
                    featureRow('auto_fix_high', 'ui_whats_new_smart_feedback_title', 'ui_whats_new_smart_feedback_body')
                ])
            ]);
            const footer = el('div', { className: 'sp-folder-modal-footer sp-welcome-footer' }, [
                el('button', { type: 'button', className: 'sp-button sp-welcome-primary-btn sp-whats-new-primary-btn sp-glare-hover' }, [
                    getMessage('ui_whats_new_primary')
                ])
            ]);

            modal.appendChild(header);
            modal.appendChild(content);
            modal.appendChild(footer);
            shadowRoot.appendChild(backdrop);
            shadowRoot.appendChild(modal);

            closeButton.addEventListener('click', closeAfterSeen);
            footer.querySelector('.sp-whats-new-primary-btn')?.addEventListener('click', closeAfterSeen);
            backdrop.addEventListener('click', closeAfterSeen);

            const modalKeyboard = bindModalKeyboardNavigation(modal, {
                closeModal: closeAfterSeen,
                initialFocusTarget: () => modal.querySelector('.sp-whats-new-primary-btn') || closeButton
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
            renderWhatsNewModal,
            closeWhatsNewModal
        };
    }

    globalThis.NSM_CREATE_CONTENT_MODAL_WHATS_NEW = createContentModalWhatsNew;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentModalWhatsNew;
    }
})();
