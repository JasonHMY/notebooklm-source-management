(function () {
    'use strict';

    // Mirrors the CSS var(--sp-motion-base) used by .sp-drag-folded,
    // .sp-drop-shift, .sp-drop-landing, .sp-drop-flying, .sp-drag-unfolding
    // (all sourced from UI_GUIDELINES motion token). Kept here as a publicly
    // queryable constant so callers can align timeouts / staggered work.
    const DEFAULT_TRANSITION_MS = 180;

    /**
     * createContentDragReflow(deps) — 拖拽 reflow / fold / drop-shift 视觉过渡引擎。
     * 拖拽期间把源行 fold 成 0 高度,对剩余可见行按 dropIntent 算 translateY shift,
     * 给目标插入点留出预览空隙;dragend / drop 时 unfold 并清 shift。所有过渡时长统一用
     * DEFAULT_TRANSITION_MS(同 UI_GUIDELINES `--sp-motion-base` token = 180ms)。
     *
     * @param {Object} deps Optional;当前实现是 pure DOM 操作,deps 仅 future-proof reserved。
     * @returns {{ TRANSITION_MS, createDragSession, prepareDragSession,
     *   foldDraggedItems, unfoldDraggedItems, computeReflow, applyReflow,
     *   clearReflow, extractInlineTranslateY }}
     *   session 维护 draggedKeys + itemHeights + shiftedItems;computeReflow 基于 dropIntent
     *   返回 shift map,applyReflow/clearReflow 落实到 inline style.transform。
     */
    function createContentDragReflow(deps = {}) {
        const _ctx = deps && typeof deps === 'object' ? deps : {};
        const itemMetricsCache = new WeakMap();
        const itemElementCacheByRoot = new WeakMap();
        const probeCssTextCache = new Map();

        function createDragSession() {
            return {
                draggedType: null,
                draggedKeys: new Set(),
                preparedElements: new Map(),
                itemMetrics: new Map(),
                itemHeights: new Map(),
                totalDraggedHeight: 0,
                draggedRuns: [],
                probeMetrics: {
                    forcedLayoutReadPhases: 0,
                    prepareCpuMs: 0
                },
                currentIntent: null,
                shiftedItems: new Map(),
                shiftedSourceItems: new Map(),
                shiftedGroupItems: new Map(),
                animatedShiftedSourceItems: new Set(),
                animatedShiftedGroupItems: new Set(),
                staticShiftClassSourceItems: new Set(),
                staticShiftClassGroupItems: new Set(),
                usesScopedShiftClasses: false
            };
        }

        // Local copy of the cssEscape helper in content-tree-interactions.js — this
        // is a standalone IIFE module and cannot reach that closure-private fn.
        // SECURITY: source keys are NotebookLM-derived (untrusted); ], backslashes,
        // or leading digits would break a `[data-...="..."]` selector, so route
        // through CSS.escape (falls back to escaping quotes + backslashes).
        function cssEscape(value) {
            const raw = typeof value === 'string' ? value : String(value ?? '');
            if (typeof globalThis.CSS === 'object' && globalThis.CSS && typeof globalThis.CSS.escape === 'function') {
                try { return globalThis.CSS.escape(raw); } catch (err) { /* fall through */ }
            }
            return raw.replace(/(["\\])/g, '\\$1');
        }

        function findItemElement(rootElement, key, draggedType = null) {
            if (!rootElement || typeof rootElement.querySelector !== 'function') return null;
            const safe = cssEscape(key);
            if (draggedType === 'source') {
                return rootElement.querySelector(`[data-source-key="${safe}"]`);
            }
            if (draggedType === 'group') {
                return rootElement.querySelector(`[data-group-id="${safe}"]`);
            }
            return rootElement.querySelector(`[data-source-key="${safe}"]`)
                || rootElement.querySelector(`[data-group-id="${safe}"]`);
        }

        function findTypedItemElement(rootElement, type, key, elements) {
            const attr = type === 'group' ? 'data-group-id' : 'data-source-key';
            const datasetKey = type === 'group' ? 'groupId' : 'sourceKey';
            if (elements instanceof Map) {
                if (!elements.has(key)) return null;
                const element = elements.get(key) || null;
                if (!element) return null;
                if (
                    rootElement
                    && typeof rootElement.contains === 'function'
                    && !rootElement.contains(element)
                ) {
                    return null;
                }
                const actualKey = typeof element.getAttribute === 'function'
                    ? element.getAttribute(attr)
                    : (element.dataset ? element.dataset[datasetKey] : null);
                return actualKey === key ? element : null;
            }
            if (!rootElement || typeof rootElement.querySelector !== 'function') return null;
            const safe = cssEscape(key);
            return rootElement.querySelector(`[${attr}="${safe}"]`);
        }

        function findItemElements(rootElement, keys, draggedType = null) {
            const requestedKeys = Array.isArray(keys) ? keys : [];
            const result = new Map();
            if (!rootElement || requestedKeys.length === 0) return result;
            let sourceElementCache = null;
            if (
                draggedType !== 'group'
                &&
                (typeof rootElement === 'object' || typeof rootElement === 'function')
                && typeof rootElement.contains === 'function'
            ) {
                sourceElementCache = itemElementCacheByRoot.get(rootElement);
                if (!sourceElementCache) {
                    sourceElementCache = new Map();
                    itemElementCacheByRoot.set(rootElement, sourceElementCache);
                }
                for (const key of requestedKeys) {
                    const cached = sourceElementCache.get(key);
                    if (
                        cached
                        && rootElement.contains(cached)
                        && typeof cached.getAttribute === 'function'
                        && cached.getAttribute('data-source-key') === key
                    ) {
                        result.set(key, cached);
                    } else if (cached) {
                        sourceElementCache.delete(key);
                    }
                }
                if (result.size === requestedKeys.length) return result;
            }

            // A selector per key is cheaper for a single drag, but turns a 50-row
            // batch into 50 repeated tree walks. Query only the requested,
            // CSS-escaped identities so the result list scales with the
            // selection rather than materializing all 500 manager rows.
            if (
                requestedKeys.length >= 8
                && typeof rootElement.querySelectorAll === 'function'
            ) {
                try {
                    if (draggedType !== 'group') {
                        const unresolvedSources = requestedKeys.filter((key) => !result.has(key));
                        const sourceCandidates = rootElement.querySelectorAll(
                            unresolvedSources
                                .map((key) => `[data-source-key="${cssEscape(key)}"]`)
                                .join(', ')
                        );
                        for (const candidate of sourceCandidates) {
                            if (!candidate || typeof candidate.getAttribute !== 'function') continue;
                            const sourceKey = candidate.getAttribute('data-source-key');
                            if (
                                typeof sourceKey === 'string'
                                && unresolvedSources.includes(sourceKey)
                                && !result.has(sourceKey)
                            ) {
                                result.set(sourceKey, candidate);
                                if (sourceElementCache) {
                                    if (sourceElementCache.size >= 512) sourceElementCache.clear();
                                    sourceElementCache.set(sourceKey, candidate);
                                }
                            }
                        }
                    }
                    const unresolved = requestedKeys.filter((key) => !result.has(key));
                    if (draggedType !== 'source' && unresolved.length > 0) {
                        const groupCandidates = rootElement.querySelectorAll(
                            unresolved
                                .map((key) => `[data-group-id="${cssEscape(key)}"]`)
                                .join(', ')
                        );
                        for (const candidate of groupCandidates) {
                            if (!candidate || typeof candidate.getAttribute !== 'function') continue;
                            const groupId = candidate.getAttribute('data-group-id');
                            if (
                                typeof groupId === 'string'
                                && unresolved.includes(groupId)
                                && !result.has(groupId)
                            ) {
                                result.set(groupId, candidate);
                            }
                        }
                    }
                } catch (err) {
                    // Missing identities fall through to escaped one-key lookup.
                }
                for (const key of requestedKeys) {
                    if (!result.has(key)) {
                        result.set(key, findItemElement(rootElement, key, draggedType));
                    }
                }
                return result;
            }

            for (const key of requestedKeys) {
                result.set(key, findItemElement(rootElement, key, draggedType));
            }
            return result;
        }

        function parsePixel(value) {
            const parsed = Number.parseFloat(value);
            return Number.isFinite(parsed) ? parsed : 0;
        }

        function resolveGetComputedStyle() {
            if (typeof _ctx.getComputedStyle === 'function') return _ctx.getComputedStyle;
            if (
                typeof globalThis.getComputedStyle === 'function'
            ) {
                return globalThis.getComputedStyle.bind(globalThis);
            }
            return null;
        }

        function measureVerticalMetrics(
            element,
            getComputedStyleFn = resolveGetComputedStyle(),
            { includeVisualRect = true } = {}
        ) {
            const measuredBorderBox = element ? Number(element.offsetHeight) : 0;
            const borderBoxHeight = Number.isFinite(measuredBorderBox)
                ? measuredBorderBox
                : 0;
            let computedStyle = null;
            if (getComputedStyleFn && element) {
                try {
                    computedStyle = getComputedStyleFn(element);
                } catch (err) {
                    computedStyle = null;
                }
            }

            const marginTop = parsePixel(computedStyle && computedStyle.marginTop);
            const marginBottom = parsePixel(computedStyle && computedStyle.marginBottom);
            const paddingBorder = parsePixel(computedStyle && computedStyle.paddingTop)
                + parsePixel(computedStyle && computedStyle.paddingBottom)
                + parsePixel(computedStyle && computedStyle.borderTopWidth)
                + parsePixel(computedStyle && computedStyle.borderBottomWidth);
            const contentHeight = Math.max(0, borderBoxHeight - paddingBorder);
            const unfoldHeight = computedStyle && computedStyle.boxSizing === 'border-box'
                ? borderBoxHeight
                : contentHeight;

            let rectLeft = 0;
            let rectTop = 0;
            let rectRight = 0;
            let rectBottom = borderBoxHeight;
            let rectWidth = 0;
            let rectHeight = borderBoxHeight;
            if (
                includeVisualRect
                && element
                && typeof element.getBoundingClientRect === 'function'
            ) {
                try {
                    const rect = element.getBoundingClientRect();
                    rectLeft = Number(rect && rect.left) || 0;
                    rectTop = Number(rect && rect.top) || 0;
                    rectRight = Number(rect && rect.right) || 0;
                    rectBottom = Number(rect && rect.bottom) || 0;
                    rectWidth = Number(rect && rect.width) || 0;
                    rectHeight = Number(rect && rect.height) || 0;
                } catch (err) {
                    // Safe fallback for detached/test elements without layout.
                }
            }

            const inlineStyle = element && element.style ? element.style : null;
            const classList = element && element.classList ? element.classList : null;
            const originalInlineHeight = inlineStyle ? inlineStyle.height || '' : '';
            const originalInlineOpacity = inlineStyle ? inlineStyle.opacity || '' : '';
            const originalInlineHeightPriority = inlineStyle
                && typeof inlineStyle.getPropertyPriority === 'function'
                ? inlineStyle.getPropertyPriority('height') || ''
                : '';
            const originalInlineOpacityPriority = inlineStyle
                && typeof inlineStyle.getPropertyPriority === 'function'
                ? inlineStyle.getPropertyPriority('opacity') || ''
                : '';
            const originalFoldedClass = Boolean(
                classList
                && typeof classList.contains === 'function'
                && classList.contains('sp-drag-folded')
            );
            const originalUnfoldingClass = Boolean(
                classList
                && typeof classList.contains === 'function'
                && classList.contains('sp-drag-unfolding')
            );
            const cached = element ? itemMetricsCache.get(element) : null;
            if (
                cached
                && cached.borderBoxHeight === borderBoxHeight
                && cached.contentHeight === contentHeight
                && cached.marginTop === marginTop
                && cached.marginBottom === marginBottom
                && cached.unfoldHeight === unfoldHeight
                && cached.originalInlineHeight === originalInlineHeight
                && cached.originalInlineOpacity === originalInlineOpacity
                && cached.originalInlineHeightPriority === originalInlineHeightPriority
                && cached.originalInlineOpacityPriority === originalInlineOpacityPriority
                && cached.originalFoldedClass === originalFoldedClass
                && cached.originalUnfoldingClass === originalUnfoldingClass
                && (
                    (
                        includeVisualRect
                        && cached.visualRect
                        && cached.visualRect.left === rectLeft
                        && cached.visualRect.top === rectTop
                        && cached.visualRect.right === rectRight
                        && cached.visualRect.bottom === rectBottom
                        && cached.visualRect.width === rectWidth
                        && cached.visualRect.height === rectHeight
                    )
                    || (!includeVisualRect && cached.visualRect === null)
                )
            ) {
                return cached;
            }

            const metrics = {
                visualRect: includeVisualRect
                    ? {
                        left: rectLeft,
                        top: rectTop,
                        right: rectRight,
                        bottom: rectBottom,
                        width: rectWidth,
                        height: rectHeight
                    }
                    : null,
                borderBoxHeight,
                contentHeight,
                marginTop,
                marginBottom,
                unfoldHeight,
                originalInlineHeight,
                originalInlineOpacity,
                originalInlineHeightPriority,
                originalInlineOpacityPriority,
                originalFoldedClass,
                originalUnfoldingClass
            };
            if (element) itemMetricsCache.set(element, metrics);
            return metrics;
        }

        function toCamelStyleProperty(name) {
            return String(name).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
        }

        function readInlineStyleProperty(style, name) {
            if (!style) return { value: '', priority: '' };
            if (typeof style.getPropertyValue === 'function') {
                return {
                    value: style.getPropertyValue(name) || '',
                    priority: typeof style.getPropertyPriority === 'function'
                        ? style.getPropertyPriority(name) || ''
                        : ''
                };
            }
            return {
                value: style[toCamelStyleProperty(name)] || '',
                priority: ''
            };
        }

        function setInlineStyleProperty(style, name, value, priority = '') {
            if (!style) return;
            if (typeof style.setProperty === 'function') {
                style.setProperty(name, value, priority);
                return;
            }
            style[toCamelStyleProperty(name)] = value;
        }

        function restoreInlineStyleProperty(style, name, saved) {
            if (!style || !saved) return;
            if (!saved.value && !saved.priority && typeof style.removeProperty === 'function') {
                style.removeProperty(name);
                return;
            }
            setInlineStyleProperty(style, name, saved.value || '', saved.priority || '');
        }

        function readInlineCssText(style) {
            if (!style || typeof style.cssText !== 'string') return null;
            return style.cssText;
        }

        function hasClass(element, name) {
            return Boolean(
                element
                && element.classList
                && typeof element.classList.contains === 'function'
                && element.classList.contains(name)
            );
        }

        function setClassMembership(element, name, enabled) {
            if (!element || !element.classList) return;
            if (enabled && typeof element.classList.add === 'function') {
                element.classList.add(name);
            } else if (!enabled && typeof element.classList.remove === 'function') {
                element.classList.remove(name);
            }
        }

        function snapshotProbeElement(element) {
            const style = element && element.style ? element.style : null;
            const originalCssText = readInlineCssText(style);
            const transition = originalCssText === null
                ? readInlineStyleProperty(style, 'transition')
                : null;
            const animation = originalCssText === null
                ? readInlineStyleProperty(style, 'animation')
                : null;
            let motionDisabledCssText = null;
            let foldedCssText = null;
            if (originalCssText !== null) {
                let cachedCssText = probeCssTextCache.get(originalCssText);
                if (!cachedCssText) {
                    cachedCssText = {
                        motionDisabled: `${originalCssText};transition: none !important; animation: none !important`,
                        folded: `${originalCssText};transition: none !important; animation: none !important;`
                            + 'height: 0px !important; opacity: 0 !important'
                    };
                    if (probeCssTextCache.size >= 64) probeCssTextCache.clear();
                    probeCssTextCache.set(originalCssText, cachedCssText);
                }
                motionDisabledCssText = cachedCssText.motionDisabled;
                foldedCssText = cachedCssText.folded;
            }
            return {
                element,
                height: readInlineStyleProperty(style, 'height'),
                opacity: readInlineStyleProperty(style, 'opacity'),
                folded: hasClass(element, 'sp-drag-folded'),
                originalCssText,
                motionDisabledCssText,
                foldedCssText,
                transition,
                animation
            };
        }

        function applyMeasurementFoldState(states) {
            for (const state of states) {
                const element = state && state.element;
                if (!element || !element.style) continue;
                if (state.foldedCssText !== null) {
                    element.style.cssText = state.foldedCssText;
                } else {
                    setInlineStyleProperty(element.style, 'transition', 'none', 'important');
                    setInlineStyleProperty(element.style, 'animation', 'none', 'important');
                    setInlineStyleProperty(element.style, 'height', '0px');
                    setInlineStyleProperty(element.style, 'opacity', '0');
                }
                setClassMembership(element, 'sp-drag-folded', true);
            }
        }

        function restoreProbeBoxAndClasses(states) {
            for (const state of states) {
                const element = state && state.element;
                if (!element || !element.style) continue;
                if (state.motionDisabledCssText !== null) {
                    element.style.cssText = state.motionDisabledCssText;
                } else {
                    restoreInlineStyleProperty(element.style, 'height', state.height);
                    restoreInlineStyleProperty(element.style, 'opacity', state.opacity);
                }
                setClassMembership(element, 'sp-drag-folded', state.folded);
            }
        }

        function directChildren(element) {
            if (!element || !element.children) return [];
            try {
                return Array.from(element.children);
            } catch (err) {
                return [];
            }
        }

        function buildDraggedRuns(selectedElements) {
            const selectedByElement = new Map();
            const selectedHosts = new Set();
            const hostChildren = new Map();
            for (const entry of selectedElements) {
                if (!entry || !entry.element || typeof entry.key !== 'string') continue;
                selectedByElement.set(entry.element, entry);
                const host = entry.element.parentElement;
                if (!host) continue;
                selectedHosts.add(host);
            }

            const runs = [];
            for (const host of selectedHosts) {
                const children = directChildren(host);
                hostChildren.set(host, children);
                if (!children.length) continue;
                const firstHostRunIndex = runs.length;
                let current = null;
                for (let index = 0; index < children.length; index += 1) {
                    const entry = selectedByElement.get(children[index]);
                    if (!entry) continue;
                    if (!current || index !== current.endIndex + 1) {
                        if (current) runs.push(current);
                        current = {
                            keys: [entry.key],
                            selectedElements: [entry.element],
                            hostElement: host,
                            startIndex: index,
                            endIndex: index,
                            successorElement: null,
                            probeAnchor: null,
                            cumulativeDisplacement: 0,
                            footprint: 0
                        };
                    } else {
                        current.keys.push(entry.key);
                        current.selectedElements.push(entry.element);
                        current.endIndex = index;
                    }
                }
                if (current) runs.push(current);

                for (let index = firstHostRunIndex; index < runs.length; index += 1) {
                    const run = runs[index];
                    run.successorElement = children[run.endIndex + 1] || null;
                }
            }
            return { runs, hostChildren };
        }

        function createInertProbeSentinel(hostElement, documentRef) {
            if (!hostElement || !documentRef || typeof documentRef.createElement !== 'function') return null;
            let sentinel = null;
            try {
                sentinel = documentRef.createElement('div');
                if (!sentinel) return null;
                if (typeof sentinel.setAttribute === 'function') {
                    sentinel.setAttribute('aria-hidden', 'true');
                    sentinel.setAttribute('role', 'presentation');
                    sentinel.setAttribute('data-sp-drag-probe', '');
                }
                if (sentinel.style) {
                    const sentinelCssText = 'height: 0px !important; min-height: 0px !important;'
                        + ' max-height: 0px !important; margin: 0 !important;'
                        + ' padding: 0 !important; border: 0 !important; overflow: hidden !important;'
                        + ' pointer-events: none !important; visibility: hidden !important;';
                    if (typeof sentinel.style.cssText === 'string') {
                        sentinel.style.cssText = sentinelCssText;
                    } else {
                        setInlineStyleProperty(sentinel.style, 'height', '0px', 'important');
                        setInlineStyleProperty(sentinel.style, 'min-height', '0px', 'important');
                        setInlineStyleProperty(sentinel.style, 'max-height', '0px', 'important');
                        setInlineStyleProperty(sentinel.style, 'margin', '0', 'important');
                        setInlineStyleProperty(sentinel.style, 'padding', '0', 'important');
                        setInlineStyleProperty(sentinel.style, 'border', '0', 'important');
                        setInlineStyleProperty(sentinel.style, 'overflow', 'hidden', 'important');
                        setInlineStyleProperty(sentinel.style, 'pointer-events', 'none', 'important');
                        setInlineStyleProperty(sentinel.style, 'visibility', 'hidden', 'important');
                    }
                }
                hostElement.appendChild(sentinel);
                return sentinel;
            } catch (err) {
                if (sentinel && sentinel.parentElement && typeof sentinel.parentElement.removeChild === 'function') {
                    try { sentinel.parentElement.removeChild(sentinel); } catch (removeError) { /* best effort */ }
                }
                return null;
            }
        }

        function removeProbeNode(node) {
            if (!node) return;
            try {
                if (typeof node.remove === 'function') {
                    node.remove();
                } else if (node.parentElement && typeof node.parentElement.removeChild === 'function') {
                    node.parentElement.removeChild(node);
                }
            } catch (err) {
                // A detached probe is already safely gone.
            }
        }

        function createFoldProbeStructure(rootElement, runs, knownHostChildren) {
            const documentRef = rootElement && rootElement.ownerDocument;
            if (!rootElement || !documentRef || typeof rootElement.appendChild !== 'function') return null;
            const sentinels = [];
            const hosts = new Set([rootElement]);
            for (const run of runs) {
                if (!run || !run.hostElement) continue;
                hosts.add(run.hostElement);
            }

            const hostChildren = knownHostChildren instanceof Map
                ? knownHostChildren
                : new Map();
            const hostEndSentinels = new Map();
            for (const host of hosts) {
                if (!hostChildren.has(host)) {
                    hostChildren.set(host, directChildren(host));
                }
            }

            // A real survivor immediately after the final selected root branch
            // is an exact outer-flow anchor: its displacement includes every
            // selected root/nested contribution before it. Prefer that bounded
            // read so a 500-row list does not have to lay out all the way to an
            // appended root-end sentinel. The sentinel remains the fail-closed
            // fallback when the selection reaches the actual list end.
            const rootChildren = hostChildren.get(rootElement) || [];
            let lastSelectedRootIndex = -1;
            for (const run of runs) {
                for (const element of run.selectedElements || []) {
                    const branch = getDirectChildUnderHost(element, rootElement);
                    const branchIndex = rootChildren.indexOf(branch);
                    if (branchIndex > lastSelectedRootIndex) {
                        lastSelectedRootIndex = branchIndex;
                    }
                }
            }
            let outerSentinel = lastSelectedRootIndex >= 0
                ? rootChildren[lastSelectedRootIndex + 1] || null
                : null;

            // Terminal runs need a zero-size sentinel in their direct host:
            // a fixed-height or non-overflowing host's own rect/scroll extent
            // can stay unchanged even though its terminal content moved. The
            // root additionally needs an outer flow-end anchor whenever the
            // last selected root branch has no real survivor. This includes a
            // nested-only selection inside the final root group.
            const sentinelHosts = new Set();
            for (const run of runs) {
                if (run && run.hostElement && !run.successorElement) {
                    sentinelHosts.add(run.hostElement);
                }
            }
            if (!outerSentinel) sentinelHosts.add(rootElement);
            for (const host of sentinelHosts) {
                const sentinel = createInertProbeSentinel(host, documentRef);
                if (!sentinel) {
                    for (const existing of sentinels) removeProbeNode(existing);
                    return null;
                }
                hostEndSentinels.set(host, sentinel);
                sentinels.push(sentinel);
            }

            for (const run of runs) {
                if (run.successorElement) {
                    run.probeAnchor = run.successorElement;
                    continue;
                }
                run.probeAnchor = hostEndSentinels.get(run.hostElement) || null;
                run.probeUsesHostEnd = !run.probeAnchor;
            }

            if (!outerSentinel) {
                outerSentinel = hostEndSentinels.get(rootElement) || null;
            }

            const childHostsByHost = new Map();
            const propagationBranchByChildHost = new Map();
            for (const host of hosts) {
                if (host === rootElement) continue;
                let ancestor = host.parentElement;
                while (ancestor && !hosts.has(ancestor)) {
                    ancestor = ancestor.parentElement;
                }
                if (!ancestor) continue;
                if (!childHostsByHost.has(ancestor)) childHostsByHost.set(ancestor, []);
                childHostsByHost.get(ancestor).push(host);
                const branch = getDirectChildUnderHost(host, ancestor);
                if (branch) propagationBranchByChildHost.set(host, branch);
            }

            return {
                rootElement,
                runs,
                hosts,
                hostChildren,
                hostEndSentinels,
                childHostsByHost,
                propagationBranchByChildHost,
                sentinels,
                outerSentinel,
                readPhases: 0
            };
        }

        function readRect(element) {
            if (!element || typeof element.getBoundingClientRect !== 'function') return null;
            try {
                const rect = element.getBoundingClientRect();
                if (!rect || !Number.isFinite(Number(rect.top))) return null;
                return rect;
            } catch (err) {
                return null;
            }
        }

        function readAllProbeAnchors(probe) {
            const elementsToRead = new Set(probe.hosts);
            for (const run of probe.runs) {
                if (run && run.probeAnchor) elementsToRead.add(run.probeAnchor);
            }
            for (const sentinel of probe.hostEndSentinels.values()) {
                elementsToRead.add(sentinel);
            }
            for (const branch of probe.propagationBranchByChildHost.values()) {
                elementsToRead.add(branch);
            }
            if (probe.outerSentinel) elementsToRead.add(probe.outerSentinel);

            const rects = new Map();
            for (const element of elementsToRead) {
                rects.set(element, readRect(element));
            }
            for (const host of probe.hosts) {
                if (!rects.get(host)) rects.set(host, { top: 0 });
            }
            const localY = (element, host) => {
                const rect = rects.get(element);
                const hostRect = rects.get(host);
                if (!rect || !hostRect) return null;
                return Number(rect.top) - Number(hostRect.top || 0)
                    + (Number(host && host.scrollTop) || 0);
            };
            const hostEnds = new Map();
            for (const host of probe.hosts) {
                const sentinel = probe.hostEndSentinels.get(host);
                if (sentinel) {
                    hostEnds.set(host, localY(sentinel, host));
                    continue;
                }
                const hostRect = rects.get(host);
                const rectHeight = hostRect
                    ? Math.max(
                        0,
                        Number(hostRect.height)
                        || (Number(hostRect.bottom) - Number(hostRect.top))
                        || 0
                    )
                    : 0;
                const scrollHeight = Number(host && host.scrollHeight) || 0;
                hostEnds.set(host, Math.max(rectHeight, scrollHeight));
            }
            const runs = new Map();
            for (const run of probe.runs) {
                runs.set(
                    run,
                    run.probeUsesHostEnd
                        ? hostEnds.get(run.hostElement)
                        : localY(run.probeAnchor, run.hostElement)
                );
            }
            const branchExtents = new Map();
            for (const branch of probe.propagationBranchByChildHost.values()) {
                if (branchExtents.has(branch)) continue;
                const rect = rects.get(branch);
                branchExtents.set(
                    branch,
                    rect
                        ? Math.max(
                            0,
                            Number(rect.height)
                            || (Number(rect.bottom) - Number(rect.top))
                            || 0
                        )
                        : null
                );
            }
            return {
                outer: localY(probe.outerSentinel, probe.rootElement),
                hostEnds,
                runs,
                branchExtents
            };
        }

        function snapshotProbeOverflowAnchor(hosts) {
            const hostState = [];
            for (const host of hosts) {
                if (!host || !host.style) continue;
                hostState.push({
                    element: host,
                    overflowAnchor: readInlineStyleProperty(host.style, 'overflow-anchor'),
                    hasScrollTop: typeof host.scrollTop === 'number',
                    scrollTop: typeof host.scrollTop === 'number' ? host.scrollTop : 0
                });
            }
            return hostState;
        }

        function applyProbeOverflowAnchor(hostState) {
            for (const entry of hostState) {
                if (!entry || !entry.element || !entry.element.style) continue;
                setInlineStyleProperty(
                    entry.element.style,
                    'overflow-anchor',
                    'none',
                    'important'
                );
            }
        }

        function restoreProbeMotionAndOverflowAnchor(state) {
            const hostState = state && Array.isArray(state.hostState)
                ? state.hostState
                : [];
            for (const entry of hostState) {
                if (!entry || !entry.element || !entry.element.style) continue;
                if (
                    entry.hasScrollTop
                    && entry.element.scrollTop !== entry.scrollTop
                ) {
                    try {
                        entry.element.scrollTop = entry.scrollTop;
                    } catch (err) {
                        // Detached/non-scrollable hosts safely ignore restoration.
                    }
                }
                restoreInlineStyleProperty(entry.element.style, 'overflow-anchor', entry.overflowAnchor);
            }
            const selectedState = state && Array.isArray(state.selectedState)
                ? state.selectedState
                : [];
            for (const entry of selectedState) {
                if (!entry || !entry.element || !entry.element.style) continue;
                if (entry.originalCssText !== null) {
                    entry.element.style.cssText = entry.originalCssText;
                } else {
                    restoreInlineStyleProperty(entry.element.style, 'transition', entry.transition);
                    restoreInlineStyleProperty(entry.element.style, 'animation', entry.animation);
                }
            }
        }

        function commitRestoredProbeLayout(states) {
            const firstConnected = states.find((state) => (
                state
                && state.element
                && typeof state.element.getBoundingClientRect === 'function'
            ));
            readRect(firstConnected && firstConnected.element);
        }

        function displacement(before, after) {
            if (!Number.isFinite(before) || !Number.isFinite(after)) return null;
            return Math.max(0, before - after);
        }

        function getDirectChildUnderHost(element, host) {
            let current = element;
            while (current && current.parentElement && current.parentElement !== host) {
                current = current.parentElement;
            }
            return current && current.parentElement === host ? current : null;
        }

        function getDescendantContributionBeforeRun({
            probe,
            run,
            propagationBranchDisplacements,
            selectedDirectChildrenByHost
        }) {
            const childHosts = probe.childHostsByHost.get(run.hostElement) || [];
            if (!childHosts.length) return 0;
            const children = probe.hostChildren.get(run.hostElement) || [];
            const anchorIndex = run.successorElement
                ? children.indexOf(run.successorElement)
                : Number.POSITIVE_INFINITY;
            const selectedDirectChildren = selectedDirectChildrenByHost.get(run.hostElement) || new Set();
            const countedBranches = new Set();
            let contribution = 0;

            for (const childHost of childHosts) {
                const branch = getDirectChildUnderHost(childHost, run.hostElement);
                if (
                    !branch
                    || countedBranches.has(branch)
                    || selectedDirectChildren.has(branch)
                ) {
                    continue;
                }
                const branchIndex = children.indexOf(branch);
                if (branchIndex < 0 || branchIndex >= anchorIndex) continue;
                countedBranches.add(branch);
                contribution += propagationBranchDisplacements.get(branch) || 0;
            }
            return contribution;
        }

        function resolveProbeDisplacements({ probe, before, after }) {
            const outerTotal = displacement(before.outer, after.outer);

            const propagationBranchDisplacements = new Map();
            for (const branch of probe.propagationBranchByChildHost.values()) {
                if (propagationBranchDisplacements.has(branch)) continue;
                const branchDisplacement = displacement(
                    before.branchExtents.get(branch),
                    after.branchExtents.get(branch)
                );
                propagationBranchDisplacements.set(
                    branch,
                    branchDisplacement === null ? 0 : branchDisplacement
                );
            }

            const selectedDirectChildrenByHost = new Map();
            for (const run of probe.runs) {
                if (!selectedDirectChildrenByHost.has(run.hostElement)) {
                    selectedDirectChildrenByHost.set(run.hostElement, new Set());
                }
                const selected = selectedDirectChildrenByHost.get(run.hostElement);
                for (const element of run.selectedElements) selected.add(element);
            }

            // Values are cumulative per direct layout host. Adjacent differences give
            // each run's footprint without reproducing CSS margin-collapse logic.
            // A parent-host anchor can also move because an earlier descendant
            // branch shrank. Subtract only the shrink that propagated through
            // that direct ancestor branch. A fixed/min-sized branch can absorb
            // its child host's full shrink, in which case its measured height
            // displacement is zero and the local run must remain independent.
            // Shared branches are counted once so deeper hosts are not doubled.
            const previousByHost = new Map();
            const resolvedRuns = [];
            for (const run of probe.runs) {
                const rawCumulative = displacement(before.runs.get(run), after.runs.get(run));
                if (rawCumulative === null) continue;
                const descendantContribution = getDescendantContributionBeforeRun({
                    probe,
                    run,
                    propagationBranchDisplacements,
                    selectedDirectChildrenByHost
                });
                const cumulative = Math.max(0, rawCumulative - descendantContribution);
                const previous = previousByHost.get(run.hostElement) || 0;
                previousByHost.set(run.hostElement, cumulative);
                resolvedRuns.push({
                    keys: run.keys.slice(),
                    hostElement: run.hostElement,
                    cumulativeDisplacement: cumulative,
                    footprint: Math.max(0, cumulative - previous)
                });
            }
            const runTotal = resolvedRuns.reduce(
                (sum, run) => sum + run.footprint,
                0
            );
            return {
                // The outer flow end captures collapsed-margin/ancestor effects,
                // while direct-host sentinels capture content displacement that
                // a fixed/min-sized ancestor can absorb. Use the larger exact
                // measurement so either containment model still opens a full
                // insertion slot; descendant contributions above have already
                // been deduped from ancestor runs.
                total: outerTotal === null
                    ? runTotal
                    : Math.max(outerTotal, runTotal),
                runs: resolvedRuns
            };
        }

        function measureBatchedFoldProbe({
            rootElement,
            runs,
            hostChildren,
            selectedElements,
            getComputedStyleFn,
            originKey
        }) {
            if (!selectedElements.length || !runs.length) return null;
            const probe = createFoldProbeStructure(rootElement, runs, hostChildren);
            if (!probe) return null;
            const boxState = selectedElements.map((entry) => snapshotProbeElement(entry.element));
            const itemMetrics = new Map();
            let motionState = { selectedState: boxState, hostState: [] };
            let result = null;
            try {
                motionState.hostState = snapshotProbeOverflowAnchor(probe.hosts);
                for (const entry of selectedElements) {
                    itemMetrics.set(
                        entry.key,
                        measureVerticalMetrics(
                            entry.element,
                            getComputedStyleFn,
                            {
                                includeVisualRect: !originKey
                                    || entry.key === originKey
                            }
                        )
                    );
                }
                const before = readAllProbeAnchors(probe);
                probe.readPhases += 1;
                // Suppression and the terminal box are one write batch. At the
                // next style/layout flush Chromium sees motion:none together
                // with the folded state, so no probe transition is created and
                // the first read phase avoids 50 separate motion invalidations.
                applyProbeOverflowAnchor(motionState.hostState);
                applyMeasurementFoldState(boxState);
                const after = readAllProbeAnchors(probe);
                probe.readPhases += 1;
                result = resolveProbeDisplacements({ probe, before, after });
            } catch (err) {
                result = null;
            } finally {
                try {
                    restoreProbeBoxAndClasses(boxState);
                    for (const sentinel of probe.sentinels) removeProbeNode(sentinel);
                    commitRestoredProbeLayout(boxState);
                    probe.readPhases += 1;
                } finally {
                    restoreProbeMotionAndOverflowAnchor(motionState);
                }
            }
            if (!result) return null;
            return {
                total: result.total,
                runs: result.runs,
                itemMetrics,
                forcedLayoutReadPhases: probe.readPhases
            };
        }

        function resolveEffectiveOriginKey({
            originKey,
            requestedKeys,
            elementsByKey,
            rootElement,
            draggedType
        }) {
            if (
                typeof originKey !== 'string'
                || !originKey
                || !requestedKeys.includes(originKey)
                || !(elementsByKey instanceof Map)
                || !elementsByKey.has(originKey)
                || !rootElement
                || typeof rootElement.contains !== 'function'
            ) {
                return null;
            }
            const element = elementsByKey.get(originKey) || null;
            if (
                !element
                || !rootElement.contains(element)
                || typeof element.getAttribute !== 'function'
            ) {
                return null;
            }
            const matchesIdentity = draggedType === 'source'
                ? element.getAttribute('data-source-key') === originKey
                : (
                    draggedType === 'group'
                        ? element.getAttribute('data-group-id') === originKey
                        : (
                            element.getAttribute('data-source-key') === originKey
                            || element.getAttribute('data-group-id') === originKey
                        )
                );
            return matchesIdentity
                ? originKey
                : null;
        }

        function prepareDragSession({
            draggedKeys,
            originKey,
            draggedType,
            rootElement
        }) {
            const session = createDragSession();
            session.draggedType = draggedType === 'source' || draggedType === 'group'
                ? draggedType
                : null;
            const keys = Array.isArray(draggedKeys) ? draggedKeys : [];
            const now = typeof _ctx.now === 'function'
                ? _ctx.now
                : (
                    typeof globalThis.performance === 'object'
                    && globalThis.performance
                    && typeof globalThis.performance.now === 'function'
                        ? globalThis.performance.now.bind(globalThis.performance)
                        : Date.now
            );
            const startedAt = now();
            const getComputedStyleFn = resolveGetComputedStyle();
            const requestedKeys = [];
            const requestedEntries = [];
            const selectedElements = [];
            for (const key of keys) {
                if (typeof key !== 'string' || !key) continue;
                if (session.draggedKeys.has(key)) continue;
                session.draggedKeys.add(key);
                requestedKeys.push(key);
            }
            const elementsByKey = findItemElements(
                rootElement,
                requestedKeys,
                session.draggedType
            );
            session.preparedElements = elementsByKey;
            const effectiveOriginKey = resolveEffectiveOriginKey({
                originKey,
                requestedKeys,
                elementsByKey,
                rootElement,
                draggedType: session.draggedType
            });
            for (const key of requestedKeys) {
                const el = elementsByKey.get(key) || null;
                const entry = { key, element: el };
                requestedEntries.push(entry);
                if (el) selectedElements.push(entry);
            }
            const runStructure = buildDraggedRuns(selectedElements);
            const runs = runStructure.runs;
            const probeResult = measureBatchedFoldProbe({
                rootElement,
                runs,
                hostChildren: runStructure.hostChildren,
                selectedElements,
                getComputedStyleFn,
                originKey: effectiveOriginKey
            });
            let fallbackTotal = 0;
            for (const entry of requestedEntries) {
                const metrics = probeResult?.itemMetrics.get(entry.key)
                    || measureVerticalMetrics(
                        entry.element,
                        getComputedStyleFn,
                        {
                            includeVisualRect: !effectiveOriginKey
                                || entry.key === effectiveOriginKey
                        }
                    );
                session.itemMetrics.set(entry.key, metrics);
                session.itemHeights.set(entry.key, metrics.borderBoxHeight);
                fallbackTotal += metrics.borderBoxHeight;
            }
            session.totalDraggedHeight = probeResult ? probeResult.total : fallbackTotal;
            session.draggedRuns = probeResult ? probeResult.runs : [];
            session.probeMetrics.forcedLayoutReadPhases = probeResult
                ? probeResult.forcedLayoutReadPhases
                : 0;
            session.probeMetrics.prepareCpuMs = Math.max(0, now() - startedAt);
            return session;
        }

        function foldDraggedItems({ session, rootElement }) {
            if (!session || !rootElement) return;
            for (const key of session.draggedKeys) {
                const el = findItemElement(rootElement, key, session.draggedType);
                if (!el || !el.style) continue;
                setInlineStyleProperty(el.style, 'height', '0px');
                setInlineStyleProperty(el.style, 'opacity', '0');
                if (el.classList && typeof el.classList.add === 'function') {
                    el.classList.add('sp-drag-folded');
                }
            }
        }

        // animated=true smoothly unfolds the dragged item from height 0 back to its cached
        // natural height (var(--sp-motion-base) = 180ms, paired with .sp-drag-unfolding CSS rule).
        // Used by dragend / esc cancel so the dragged row doesn't "snap" back into the list.
        // animated=false (default) does an instant restore — used by drop where render()
        // already rebuilt the DOM so transition would be a no-op anyway.
        function unfoldDraggedItems({ session, rootElement, animated }) {
            if (!session || !rootElement) return;
            const win = (typeof globalThis !== 'undefined' && typeof globalThis.setTimeout === 'function')
                ? globalThis
                : null;
            for (const key of session.draggedKeys) {
                const el = findItemElement(rootElement, key, session.draggedType);
                if (!el || !el.style) continue;
                const isFolded = el.classList && typeof el.classList.contains === 'function'
                    && el.classList.contains('sp-drag-folded');
                const metrics = session.itemMetrics && typeof session.itemMetrics.get === 'function'
                    ? session.itemMetrics.get(key)
                    : null;
                const unfoldHeight = metrics && typeof metrics.unfoldHeight === 'number'
                    ? metrics.unfoldHeight
                    : null;
                const originalInlineHeight = {
                    value: metrics ? metrics.originalInlineHeight : '',
                    priority: metrics ? metrics.originalInlineHeightPriority : ''
                };
                const originalInlineOpacity = {
                    value: metrics ? metrics.originalInlineOpacity : '',
                    priority: metrics ? metrics.originalInlineOpacityPriority : ''
                };
                const restoreOriginalState = () => {
                    if (el.style) {
                        restoreInlineStyleProperty(el.style, 'height', originalInlineHeight);
                        restoreInlineStyleProperty(el.style, 'opacity', originalInlineOpacity);
                    }
                    if (el.classList && typeof el.classList.remove === 'function') {
                        if (metrics && metrics.originalFoldedClass) {
                            el.classList.add('sp-drag-folded');
                        } else {
                            el.classList.remove('sp-drag-folded');
                        }
                        if (metrics && metrics.originalUnfoldingClass) {
                            el.classList.add('sp-drag-unfolding');
                        } else {
                            el.classList.remove('sp-drag-unfolding');
                        }
                    }
                };
                if (animated && isFolded && typeof unfoldHeight === 'number' && unfoldHeight > 0) {
                    // Smooth path: swap fold class → unfolding class, set explicit pixel height +
                    // opacity 1 so transition rules have well-defined from/to values.
                    if (el.classList && typeof el.classList.add === 'function') {
                        el.classList.add('sp-drag-unfolding');
                    }
                    el.classList.remove('sp-drag-folded');
                    setInlineStyleProperty(el.style, 'height', `${unfoldHeight}px`);
                    setInlineStyleProperty(el.style, 'opacity', '1');
                    const cleanup = () => {
                        restoreOriginalState();
                    };
                    if (win) win.setTimeout(cleanup, 240);
                    continue;
                }
                // Instant path: suppress any row-level transition while restoring the
                // original box/class state, commit that expanded layout, then restore
                // motion properties. This keeps animated:false genuinely synchronous
                // even when the row's baseline CSS also transitions height/margins.
                const transition = readInlineStyleProperty(el.style, 'transition');
                const animation = readInlineStyleProperty(el.style, 'animation');
                setInlineStyleProperty(el.style, 'transition', 'none', 'important');
                setInlineStyleProperty(el.style, 'animation', 'none', 'important');
                try {
                    restoreOriginalState();
                    readRect(el);
                } finally {
                    restoreInlineStyleProperty(el.style, 'transition', transition);
                    restoreInlineStyleProperty(el.style, 'animation', animation);
                }
            }
        }

        function computeReflow({ session, insertIndex, siblingKeys }) {
            const shifts = new Map();
            if (!session || !Array.isArray(siblingKeys)) return shifts;
            if (typeof insertIndex !== 'number' || insertIndex < 0) return shifts;

            const slotHeight = session.totalDraggedHeight;
            if (slotHeight <= 0) return shifts;

            for (let i = insertIndex; i < siblingKeys.length; i += 1) {
                const key = siblingKeys[i];
                if (typeof key !== 'string' || !key) continue;
                if (session.draggedKeys.has(key)) continue;
                shifts.set(key, slotHeight);
            }
            return shifts;
        }

        function applyTypedReflow({
            session,
            shifts,
            rootElement,
            sourceElements,
            groupElements
        }) {
            const sourceShifts = shifts.sources instanceof Map ? shifts.sources : new Map();
            const groupShifts = shifts.groups instanceof Map ? shifts.groups : new Map();
            if (!(session.shiftedSourceItems instanceof Map)) session.shiftedSourceItems = new Map();
            if (!(session.shiftedGroupItems instanceof Map)) session.shiftedGroupItems = new Map();
            if (!(session.animatedShiftedSourceItems instanceof Set)) {
                session.animatedShiftedSourceItems = new Set();
            }
            if (!(session.animatedShiftedGroupItems instanceof Set)) {
                session.animatedShiftedGroupItems = new Set();
            }
            if (!(session.staticShiftClassSourceItems instanceof Set)) {
                session.staticShiftClassSourceItems = new Set();
            }
            if (!(session.staticShiftClassGroupItems instanceof Set)) {
                session.staticShiftClassGroupItems = new Set();
            }
            let complete = true;
            const appliedShiftDeltas = {
                sources: new Map(),
                groups: new Map()
            };
            const shiftDeltaPlan = shifts._shiftDeltaPlan;
            const plannedShiftDeltas = shiftDeltaPlan && shiftDeltaPlan.deltas;
            const shiftDeltaBases = shiftDeltaPlan && shiftDeltaPlan.bases;
            const shiftDeltaBaseSizes = shiftDeltaPlan && shiftDeltaPlan.baseSizes;
            const animatedShiftKeys = shiftDeltaPlan && shiftDeltaPlan.animatedKeys;
            const usesScopedShiftAnimation = Boolean(
                animatedShiftKeys
                && animatedShiftKeys.sources instanceof Set
                && animatedShiftKeys.groups instanceof Set
            );
            const hasValidPlannedDeltaMap = (next, current, planned, base, baseSize) => {
                if (
                    !(planned instanceof Map)
                    || base !== current
                    || current.size !== baseSize
                ) {
                    return false;
                }
                for (const [key, expectedDelta] of planned) {
                    const actualDelta = (Number(next.get(key)) || 0)
                        - (Number(current.get(key)) || 0);
                    if (actualDelta !== expectedDelta) return false;
                }
                return true;
            };
            const canUsePlannedSourceDeltas = Boolean(
                plannedShiftDeltas
                && shiftDeltaBases
                && shiftDeltaBaseSizes
                && hasValidPlannedDeltaMap(
                    sourceShifts,
                    session.shiftedSourceItems,
                    plannedShiftDeltas.sources,
                    shiftDeltaBases.sources,
                    shiftDeltaBaseSizes.sources
                )
            );
            const canUsePlannedGroupDeltas = Boolean(
                plannedShiftDeltas
                && shiftDeltaBases
                && shiftDeltaBaseSizes
                && hasValidPlannedDeltaMap(
                    groupShifts,
                    session.shiftedGroupItems,
                    plannedShiftDeltas.groups,
                    shiftDeltaBases.groups,
                    shiftDeltaBaseSizes.groups
                )
            );

            const applyNamespace = (
                type,
                next,
                current,
                elements,
                deltas,
                planned = null,
                desiredAnimated = null,
                currentAnimated = null,
                currentStatic = null
            ) => {
                const usesScopedClasses = desiredAnimated instanceof Set
                    && currentAnimated instanceof Set
                    && currentStatic instanceof Set;
                const applyShiftClasses = (el, key) => {
                    if (!el || !el.classList) return;
                    if (usesScopedClasses && !desiredAnimated.has(key)) {
                        if (typeof el.classList.add === 'function') {
                            el.classList.add('sp-drop-shift-static');
                        }
                        if (typeof el.classList.remove === 'function') {
                            el.classList.remove('sp-drop-shift');
                        }
                        currentAnimated.delete(key);
                        currentStatic.add(key);
                        return;
                    }
                    if (typeof el.classList.add === 'function') {
                        el.classList.add('sp-drop-shift');
                    }
                    if (typeof el.classList.remove === 'function') {
                        el.classList.remove('sp-drop-shift-static');
                    }
                    if (usesScopedClasses) {
                        currentAnimated.add(key);
                        currentStatic.delete(key);
                    }
                };
                const applyKey = (key) => {
                    const previousDelta = current.get(key);
                    if (!next.has(key)) {
                        if (!current.has(key)) return;
                        const el = findTypedItemElement(rootElement, type, key, elements);
                        if (!el || !el.style) {
                            complete = false;
                            current.delete(key);
                            if (usesScopedClasses) {
                                currentAnimated.delete(key);
                                currentStatic.delete(key);
                            }
                            return;
                        }
                        el.style.transform = '';
                        if (el.classList && typeof el.classList.remove === 'function') {
                            el.classList.remove('sp-drop-shift');
                            if (!usesScopedClasses || !currentStatic.has(key)) {
                                el.classList.remove('sp-drop-shift-static');
                            }
                        }
                        current.delete(key);
                        if (usesScopedClasses) currentAnimated.delete(key);
                        if (!usesScopedClasses) currentStatic?.delete(key);
                        const appliedDelta = -(Number(previousDelta) || 0);
                        if (appliedDelta !== 0) deltas.set(key, appliedDelta);
                        return;
                    }
                    const delta = next.get(key);
                    if (previousDelta === delta) return;
                    const el = findTypedItemElement(rootElement, type, key, elements);
                    if (!el || !el.style) {
                        complete = false;
                        return;
                    }
                    el.style.transform = `translateY(${delta}px)`;
                    applyShiftClasses(el, key);
                    current.set(key, delta);
                    const appliedDelta = (Number(delta) || 0) - (Number(previousDelta) || 0);
                    if (appliedDelta !== 0) deltas.set(key, appliedDelta);
                };

                if (planned instanceof Map) {
                    for (const key of planned.keys()) applyKey(key);
                    return;
                }
                for (const key of Array.from(current.keys())) {
                    if (!next.has(key)) applyKey(key);
                }
                for (const [key, delta] of next) {
                    if (current.get(key) !== delta) applyKey(key);
                }
            };

            const sourceAnimated = usesScopedShiftAnimation
                ? animatedShiftKeys.sources
                : null;
            const groupAnimated = usesScopedShiftAnimation
                ? animatedShiftKeys.groups
                : null;
            applyNamespace(
                'source',
                sourceShifts,
                session.shiftedSourceItems,
                sourceElements,
                appliedShiftDeltas.sources,
                canUsePlannedSourceDeltas ? plannedShiftDeltas.sources : null,
                sourceAnimated,
                session.animatedShiftedSourceItems,
                session.staticShiftClassSourceItems
            );
            applyNamespace(
                'group',
                groupShifts,
                session.shiftedGroupItems,
                groupElements,
                appliedShiftDeltas.groups,
                canUsePlannedGroupDeltas ? plannedShiftDeltas.groups : null,
                groupAnimated,
                session.animatedShiftedGroupItems,
                session.staticShiftClassGroupItems
            );
            const syncScopedAnimationClasses = (
                type,
                next,
                elements,
                desired,
                currentAnimated,
                currentStatic
            ) => {
                for (const key of Array.from(currentAnimated)) {
                    if (desired.has(key) && next.has(key)) continue;
                    const el = findTypedItemElement(rootElement, type, key, elements);
                    if (!el || !el.classList) {
                        complete = false;
                        currentAnimated.delete(key);
                        continue;
                    }
                    if (typeof el.classList.add === 'function' && next.has(key)) {
                        el.classList.add('sp-drop-shift-static');
                    }
                    if (typeof el.classList.remove === 'function') {
                        el.classList.remove('sp-drop-shift');
                    }
                    currentAnimated.delete(key);
                    if (next.has(key)) currentStatic.add(key);
                }
                for (const key of desired) {
                    if (!next.has(key) || currentAnimated.has(key)) continue;
                    const el = findTypedItemElement(rootElement, type, key, elements);
                    if (!el || !el.classList) {
                        complete = false;
                        continue;
                    }
                    if (typeof el.classList.add === 'function') {
                        el.classList.add('sp-drop-shift');
                    }
                    if (typeof el.classList.remove === 'function') {
                        el.classList.remove('sp-drop-shift-static');
                    }
                    currentAnimated.add(key);
                    currentStatic.delete(key);
                }
            };
            if (usesScopedShiftAnimation) {
                syncScopedAnimationClasses(
                    'source',
                    sourceShifts,
                    sourceElements,
                    animatedShiftKeys.sources,
                    session.animatedShiftedSourceItems,
                    session.staticShiftClassSourceItems
                );
                syncScopedAnimationClasses(
                    'group',
                    groupShifts,
                    groupElements,
                    animatedShiftKeys.groups,
                    session.animatedShiftedGroupItems,
                    session.staticShiftClassGroupItems
                );
                session.usesScopedShiftClasses = true;
            } else {
                if (session.usesScopedShiftClasses) {
                    const restoreAnimatedNamespace = (
                        type,
                        next,
                        elements,
                        currentStatic
                    ) => {
                        for (const key of next.keys()) {
                            const el = findTypedItemElement(rootElement, type, key, elements);
                            if (!el || !el.classList) {
                                complete = false;
                                continue;
                            }
                            if (typeof el.classList.add === 'function') {
                                el.classList.add('sp-drop-shift');
                            }
                            if (typeof el.classList.remove === 'function') {
                                el.classList.remove('sp-drop-shift-static');
                            }
                        }
                        for (const key of currentStatic) {
                            if (next.has(key)) continue;
                            const el = findTypedItemElement(rootElement, type, key, elements);
                            if (
                                el
                                && el.classList
                                && typeof el.classList.remove === 'function'
                            ) {
                                el.classList.remove('sp-drop-shift-static');
                            }
                        }
                    };
                    restoreAnimatedNamespace(
                        'source',
                        sourceShifts,
                        sourceElements,
                        session.staticShiftClassSourceItems
                    );
                    restoreAnimatedNamespace(
                        'group',
                        groupShifts,
                        groupElements,
                        session.staticShiftClassGroupItems
                    );
                }
                session.usesScopedShiftClasses = false;
                session.animatedShiftedSourceItems.clear();
                session.animatedShiftedGroupItems.clear();
                session.staticShiftClassSourceItems.clear();
                session.staticShiftClassGroupItems.clear();
            }
            return { complete, appliedShiftDeltas };
        }

        function applyReflow({
            session,
            shifts,
            rootElement,
            sourceElements,
            groupElements
        }) {
            if (!session || !rootElement) return;
            if (
                shifts
                && typeof shifts === 'object'
                && !(shifts instanceof Map)
                && (shifts.sources instanceof Map || shifts.groups instanceof Map)
            ) {
                return applyTypedReflow({
                    session,
                    shifts,
                    rootElement,
                    sourceElements,
                    groupElements
                });
            }
            const next = shifts instanceof Map ? shifts : new Map();

            for (const key of session.shiftedItems.keys()) {
                if (!next.has(key)) {
                    const el = findItemElement(rootElement, key);
                    if (el && el.style) el.style.transform = '';
                    if (el && el.classList && typeof el.classList.remove === 'function') {
                        el.classList.remove('sp-drop-shift');
                    }
                    session.shiftedItems.delete(key);
                }
            }

            for (const [key, delta] of next) {
                const prev = session.shiftedItems.get(key);
                if (prev === delta) continue;
                const el = findItemElement(rootElement, key);
                if (!el || !el.style) continue;
                el.style.transform = `translateY(${delta}px)`;
                if (el.classList && typeof el.classList.add === 'function') {
                    el.classList.add('sp-drop-shift');
                }
                session.shiftedItems.set(key, delta);
            }
            return { complete: true };
        }

        function clearReflow({
            session,
            rootElement,
            sourceElements,
            groupElements
        }) {
            if (!session || !rootElement) return;
            const clearNamespace = (type, current, staticKeys, elements) => {
                if (!(current instanceof Map)) return;
                const keys = new Set(current.keys());
                if (staticKeys instanceof Set) {
                    for (const key of staticKeys) keys.add(key);
                }
                for (const key of keys) {
                    const el = findTypedItemElement(rootElement, type, key, elements);
                    if (el && el.style) el.style.transform = '';
                    if (el && el.classList && typeof el.classList.remove === 'function') {
                        el.classList.remove('sp-drop-shift');
                        el.classList.remove('sp-drop-shift-static');
                    }
                }
                current.clear();
                if (staticKeys instanceof Set) staticKeys.clear();
            };
            clearNamespace(
                'source',
                session.shiftedSourceItems,
                session.staticShiftClassSourceItems,
                sourceElements
            );
            clearNamespace(
                'group',
                session.shiftedGroupItems,
                session.staticShiftClassGroupItems,
                groupElements
            );
            for (const key of session.shiftedItems.keys()) {
                const el = findItemElement(rootElement, key);
                if (el && el.style) el.style.transform = '';
                if (el && el.classList && typeof el.classList.remove === 'function') {
                    el.classList.remove('sp-drop-shift');
                    el.classList.remove('sp-drop-shift-static');
                }
            }
            session.shiftedItems.clear();
            if (session.animatedShiftedSourceItems instanceof Set) {
                session.animatedShiftedSourceItems.clear();
            }
            if (session.animatedShiftedGroupItems instanceof Set) {
                session.animatedShiftedGroupItems.clear();
            }
            session.usesScopedShiftClasses = false;
        }

        // Extract translateY pixel offset from an inline `transform: translateY(Npx)` value.
        // Returns 0 when absent or unparseable. Used by drop-intent detection so an active
        // reflow shift on a sibling does not influence which slot the pointer is mapped to.
        function extractInlineTranslateY(el) {
            if (!el || !el.style) return 0;
            const t = el.style.transform || '';
            if (!t) return 0;
            const m = t.match(/translateY\((-?\d+(?:\.\d+)?)px\)/);
            return m ? parseFloat(m[1]) : 0;
        }

        return {
            TRANSITION_MS: DEFAULT_TRANSITION_MS,
            supportsAppliedShiftDeltas: true,
            createDragSession,
            prepareDragSession,
            foldDraggedItems,
            unfoldDraggedItems,
            computeReflow,
            applyReflow,
            clearReflow,
            extractInlineTranslateY
        };
    }

    globalThis.NSM_CREATE_CONTENT_DRAG_REFLOW = createContentDragReflow;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentDragReflow;
    }
})();
