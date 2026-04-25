(function () {
    'use strict';

    function createContentPanelDom(deps = {}) {
        const {
            document: documentObj = globalThis.document,
            window: windowObj = globalThis.window,
            MutationObserver: MutationObserverCtor = globalThis.MutationObserver,
            ResizeObserver: ResizeObserverCtor = globalThis.ResizeObserver,
            setTimeout: setTimeoutFn = globalThis.setTimeout,
            clearTimeout: clearTimeoutFn = globalThis.clearTimeout,
            DEPS = {},
            SCROLL_AREA_SELECTOR = ''
        } = deps;
        const runtime = deps.runtime || deps;

        const SOURCE_PANEL_CONTENT_SELECTORS = Array.from(new Set([
            '[data-testid="scroll-area"]',
            '.scroll-area-desktop',
            '.sources-list-container',
            SCROLL_AREA_SELECTOR,
            ...(Array.isArray(DEPS.scroll) ? DEPS.scroll : [])
        ].filter(Boolean)));
        const SOURCE_PANEL_INLINE_CONTENT_TEXT_PATTERN = /add\s+source|select\s+all|label_auto|label|labels|categor(?:y|ies|ize)|group|groups|添加来源|全选|标签|分类|分组/i;
        const SOURCE_PANEL_INLINE_CONTENT_SELECTORS = [
            'button',
            '[role="button"]',
            'input[type="checkbox"]',
            'textarea',
            'input'
        ];

        function findElement(selectors, parent = documentObj) {
            for (const sel of selectors) {
                const el = parent.querySelector(sel);
                if (el) return el;
            }
            return null;
        }

        function queryAllElements(selectors, parent = documentObj) {
            const queryRoot = parent && typeof parent.querySelectorAll === 'function' ? parent : documentObj;
            for (const sel of selectors) {
                const els = queryRoot.querySelectorAll(sel);
                if (els.length > 0) return els;
            }
            return [];
        }

        function waitForElement(selectors, options = {}) {
            const {
                observerRoot = documentObj.body,
                timeoutMs = 0
            } = options;

            return new Promise(resolve => {
                const check = () => findElement(selectors);
                const el = check();
                if (el) return resolve(el);

                const observer = new MutationObserverCtor(() => {
                    const found = check();
                    if (found) {
                        resolve(found);
                        observer.disconnect();
                    }
                });

                observer.observe(observerRoot || documentObj.body, {
                    childList: true,
                    subtree: true
                });

                if (timeoutMs > 0) {
                    setTimeoutFn(() => {
                        observer.disconnect();
                        resolve(check() || null);
                    }, timeoutMs);
                }
            });
        }

        function findSourcePanel(parent = documentObj) {
            return findElement(DEPS.panel, parent);
        }

        function findSourcePanelContent(panel = findSourcePanel()) {
            if (!panel) return null;
            return findElement(SOURCE_PANEL_CONTENT_SELECTORS, panel);
        }

        function getSourcePanelHeader(panel = findSourcePanel()) {
            if (!panel) return null;
            return panel.querySelector('.panel-header') || panel.firstElementChild || null;
        }

        function getElementComputedStyle(target) {
            if (!target) return null;
            if (windowObj && typeof windowObj.getComputedStyle === 'function') {
                return windowObj.getComputedStyle(target);
            }
            if (documentObj?.defaultView && typeof documentObj.defaultView.getComputedStyle === 'function') {
                return documentObj.defaultView.getComputedStyle(target);
            }
            return target.style || null;
        }

        function isTransparentColor(value) {
            const normalizedValue = String(value || '').trim().toLowerCase();
            if (!normalizedValue || normalizedValue === 'transparent') {
                return true;
            }

            const rgbaMatch = normalizedValue.match(/^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([0-9.]+)\s*\)$/);
            if (rgbaMatch) {
                return Number(rgbaMatch[1]) === 0;
            }

            const hslaMatch = normalizedValue.match(/^hsla\(\s*[-\d.]+\s*,\s*[-\d.]+%\s*,\s*[-\d.]+%\s*,\s*([0-9.]+)\s*\)$/);
            if (hslaMatch) {
                return Number(hslaMatch[1]) === 0;
            }

            return false;
        }

        function resolveSourcePanelSurfaceColor(panel = findSourcePanel()) {
            const sourcePanel = panel || findSourcePanel();
            if (!sourcePanel) return '';

            const candidates = [
                getSourcePanelHeader(sourcePanel),
                sourcePanel,
                sourcePanel.parentElement
            ].filter(Boolean);

            for (const candidate of candidates) {
                const computedStyle = getElementComputedStyle(candidate);
                const backgroundColor = computedStyle?.backgroundColor || candidate?.style?.backgroundColor || '';
                if (!isTransparentColor(backgroundColor)) {
                    return backgroundColor;
                }
            }

            return '';
        }

        function applySourcePanelSurfaceColor(host = runtime.extensionHost, panel = findSourcePanel()) {
            const targetHost = host || runtime.extensionHost;
            const hostStyle = targetHost?.style;
            if (!hostStyle || typeof hostStyle.setProperty !== 'function') {
                return '';
            }

            const resolvedColor = resolveSourcePanelSurfaceColor(panel);
            if (resolvedColor) {
                hostStyle.setProperty('--sp-panel-bg', resolvedColor);
            } else if (typeof hostStyle.removeProperty === 'function') {
                hostStyle.removeProperty('--sp-panel-bg');
            }

            return resolvedColor;
        }

        function getElementBoundingRect(target) {
            if (!target || typeof target.getBoundingClientRect !== 'function') return null;
            try {
                return target.getBoundingClientRect();
            } catch (error) {
                return null;
            }
        }

        function hasRenderableBox(target) {
            const rect = getElementBoundingRect(target);
            if (rect && (rect.width > 0 || rect.height > 0)) {
                return true;
            }

            const widths = [
                Number(target?.offsetWidth) || 0,
                Number(target?.clientWidth) || 0,
                Number(target?.scrollWidth) || 0
            ];
            const heights = [
                Number(target?.offsetHeight) || 0,
                Number(target?.clientHeight) || 0,
                Number(target?.scrollHeight) || 0
            ];
            return Math.max(...widths) > 0 || Math.max(...heights) > 0;
        }

        function isElementRenderable(target) {
            if (!target) return false;
            if ('isConnected' in target && target.isConnected === false) return false;
            if (target.hidden === true) return false;
            if (typeof target.getAttribute === 'function' && target.getAttribute('aria-hidden') === 'true') {
                return false;
            }
            if (typeof target.matches === 'function' && target.matches('[hidden], [aria-hidden="true"]')) {
                return false;
            }

            const computedStyle = getElementComputedStyle(target);
            if (computedStyle) {
                // We intentionally hide the native source list with visibility:hidden
                // while keeping its layout box alive, so visibility alone should not
                // be treated as a collapsed panel signal.
                if (computedStyle.display === 'none') {
                    return false;
                }
            }

            return hasRenderableBox(target);
        }

        function getElementTextSignal(target) {
            if (!target) return '';
            const parts = [];
            ['aria-label', 'title', 'placeholder'].forEach((attr) => {
                const value = typeof target.getAttribute === 'function' ? target.getAttribute(attr) : '';
                if (value) parts.push(value);
            });
            if (typeof target.textContent === 'string') {
                parts.push(target.textContent);
            }
            return parts.join(' ').replace(/\s+/g, ' ').trim();
        }

        function isElementInsideHeader(target, header) {
            if (!target || !header) return false;
            if (target === header) return true;
            return typeof header.contains === 'function' && header.contains(target);
        }

        function hasInlineSourcePanelContent(panel) {
            if (!panel || typeof panel.querySelectorAll !== 'function') return false;
            const header = getSourcePanelHeader(panel);
            const candidates = [];
            SOURCE_PANEL_INLINE_CONTENT_SELECTORS.forEach((selector) => {
                try {
                    candidates.push(...Array.from(panel.querySelectorAll(selector)));
                } catch (error) {
                    // Ignore selector support differences in NotebookLM's runtime DOM.
                }
            });

            return candidates.some((candidate) => (
                candidate &&
                !isElementInsideHeader(candidate, header) &&
                isElementRenderable(candidate) &&
                SOURCE_PANEL_INLINE_CONTENT_TEXT_PATTERN.test(getElementTextSignal(candidate))
            ));
        }

        function isSourcePanelCollapsed(panel) {
            const sourcePanel = panel || findSourcePanel();
            if (!sourcePanel || !isElementRenderable(sourcePanel)) return true;
            const panelContent = findSourcePanelContent(sourcePanel);
            if (panelContent) {
                return !isElementRenderable(panelContent);
            }
            return !hasInlineSourcePanelContent(sourcePanel);
        }

        function isSourcePanelRenderable(panel) {
            const sourcePanel = panel || findSourcePanel();
            return Boolean(sourcePanel) && !isSourcePanelCollapsed(sourcePanel);
        }

        function isManagerAttachedToPanel(panel) {
            return Boolean(
                panel &&
                runtime.attachedSourcePanel === panel &&
                runtime.extensionHost &&
                (!('isConnected' in runtime.extensionHost) || runtime.extensionHost.isConnected !== false) &&
                runtime.shadowRoot &&
                runtime.shadowRoot.host &&
                (!('isConnected' in runtime.shadowRoot.host) || runtime.shadowRoot.host.isConnected !== false)
            );
        }

        function clearScheduledPanelLifecycleSync() {
            const debounced = runtime.debouncedPanelLifecycleSync;
            if (typeof debounced?.cancel === 'function') {
                debounced.cancel();
            }
            if (runtime.panelLifecycleAnimationFrame != null && windowObj && typeof windowObj.cancelAnimationFrame === 'function') {
                windowObj.cancelAnimationFrame(runtime.panelLifecycleAnimationFrame);
            }
            runtime.panelLifecycleAnimationFrame = null;
            if (runtime.panelLifecycleTimeout != null) {
                clearTimeoutFn(runtime.panelLifecycleTimeout);
                runtime.panelLifecycleTimeout = null;
            }
        }

        function schedulePanelLifecycleSync(options = {}) {
            const { immediate = false } = options;
            const debounced = runtime.debouncedPanelLifecycleSync;
            if (immediate) {
                if (typeof debounced?.cancel === 'function') {
                    debounced.cancel();
                }
                runtime.syncManagerWithPanelLifecycle();
                return;
            }
            debounced();
        }

        function handleSourcePanelHeaderInteraction() {
            schedulePanelLifecycleSync({ immediate: true });
            if (windowObj && typeof windowObj.requestAnimationFrame === 'function') {
                if (runtime.panelLifecycleAnimationFrame != null && typeof windowObj.cancelAnimationFrame === 'function') {
                    windowObj.cancelAnimationFrame(runtime.panelLifecycleAnimationFrame);
                }
                runtime.panelLifecycleAnimationFrame = windowObj.requestAnimationFrame(() => {
                    runtime.panelLifecycleAnimationFrame = null;
                    schedulePanelLifecycleSync();
                });
            } else {
                schedulePanelLifecycleSync();
            }

            if (runtime.panelLifecycleTimeout != null) {
                clearTimeoutFn(runtime.panelLifecycleTimeout);
            }
            runtime.panelLifecycleTimeout = setTimeoutFn(() => {
                runtime.panelLifecycleTimeout = null;
                schedulePanelLifecycleSync();
            }, 120);
        }

        function bindPanelLifecycleHooks(panel = findSourcePanel()) {
            if (!panel) {
                if (runtime.panelResizeObserver) {
                    runtime.panelResizeObserver.disconnect();
                    runtime.panelResizeObserver = null;
                }
                if (runtime.attachedPanelHeader && typeof runtime.attachedPanelHeader.removeEventListener === 'function') {
                    runtime.attachedPanelHeader.removeEventListener('click', handleSourcePanelHeaderInteraction, true);
                }
                runtime.attachedPanelHeader = null;
                clearScheduledPanelLifecycleSync();
                return;
            }

            const panelHeader = getSourcePanelHeader(panel);
            if (runtime.attachedPanelHeader !== panelHeader) {
                if (runtime.attachedPanelHeader && typeof runtime.attachedPanelHeader.removeEventListener === 'function') {
                    runtime.attachedPanelHeader.removeEventListener('click', handleSourcePanelHeaderInteraction, true);
                }
                runtime.attachedPanelHeader = panelHeader;
                if (runtime.attachedPanelHeader && typeof runtime.attachedPanelHeader.addEventListener === 'function') {
                    runtime.attachedPanelHeader.addEventListener('click', handleSourcePanelHeaderInteraction, true);
                }
            }

            if (typeof ResizeObserverCtor !== 'function') return;

            if (!runtime.panelResizeObserver) {
                runtime.panelResizeObserver = new ResizeObserverCtor(() => {
                    schedulePanelLifecycleSync();
                });
            }
            runtime.panelResizeObserver.disconnect();
            runtime.panelResizeObserver.observe(panel);
            const panelContent = findSourcePanelContent(panel);
            if (panelContent) {
                runtime.panelResizeObserver.observe(panelContent);
            }
        }

        return {
            findElement,
            queryAllElements,
            waitForElement,
            findSourcePanel,
            findSourcePanelContent,
            getSourcePanelHeader,
            getElementComputedStyle,
            isTransparentColor,
            resolveSourcePanelSurfaceColor,
            applySourcePanelSurfaceColor,
            getElementBoundingRect,
            hasRenderableBox,
            isElementRenderable,
            isSourcePanelCollapsed,
            isSourcePanelRenderable,
            isManagerAttachedToPanel,
            clearScheduledPanelLifecycleSync,
            schedulePanelLifecycleSync,
            handleSourcePanelHeaderInteraction,
            bindPanelLifecycleHooks
        };
    }

    globalThis.NSM_CREATE_CONTENT_PANEL_DOM = createContentPanelDom;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentPanelDom;
    }
})();
