(function () {
    'use strict';

    // The same spring used by beUI's Sortable List. One frame loop updates every
    // moving row, so a large selection does not schedule one RAF per element.
    const STIFFNESS = 360;
    const DAMPING = 32;
    const MASS = 0.6;
    const POSITION_EPSILON = 0.1;
    const VELOCITY_EPSILON = 0.1;
    const DISCRIMINANT = Math.sqrt(DAMPING * DAMPING - 4 * MASS * STIFFNESS);
    const SLOW_RATE = (-DAMPING + DISCRIMINANT) / (2 * MASS);
    const FAST_RATE = (-DAMPING - DISCRIMINANT) / (2 * MASS);

    function createContentDragMotion(deps = {}) {
        const requestFrame = deps.requestAnimationFrame
            || (typeof globalThis.requestAnimationFrame === 'function'
                ? globalThis.requestAnimationFrame.bind(globalThis) : null);
        const cancelFrame = deps.cancelAnimationFrame
            || (typeof globalThis.cancelAnimationFrame === 'function'
                ? globalThis.cancelAnimationFrame.bind(globalThis) : null);
        const now = deps.now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
        const isReducedMotion = deps.isReducedMotion || (() => Boolean(
            typeof globalThis.matchMedia === 'function'
            && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches
        ));
        const states = new Map();
        let frameId = null;
        let lastTime = null;

        function readTransform(style) {
            return {
                value: typeof style.getPropertyValue === 'function'
                    ? (style.getPropertyValue('transform') || '')
                    : (style.transform || ''),
                priority: typeof style.getPropertyPriority === 'function'
                    ? (style.getPropertyPriority('transform') || '') : ''
            };
        }

        function writeTransform(style, value, priority = '') {
            if (typeof style.setProperty === 'function') {
                style.setProperty('transform', value, priority);
            } else {
                style.transform = value;
            }
        }

        function restore(state) {
            const { style, original } = state;
            if (!original.value && !original.priority && typeof style.removeProperty === 'function') {
                style.removeProperty('transform');
            } else {
                writeTransform(style, original.value, original.priority);
            }
        }

        function render(state) {
            if (Math.abs(state.current) < POSITION_EPSILON && state.target === 0) {
                restore(state);
                return;
            }
            const base = state.original.value && state.original.value !== 'none'
                ? `${state.original.value} ` : '';
            writeTransform(state.style, `${base}translateY(${state.current}px)`, state.original.priority);
        }

        function complete(state) {
            const callback = state.onComplete;
            state.onComplete = null;
            if (typeof callback === 'function') callback();
        }

        function cancelScheduledFrame() {
            if (frameId !== null && cancelFrame) cancelFrame(frameId);
            frameId = null;
            lastTime = null;
        }

        function stopIfIdle() {
            if (![...states.values()].some((state) => state.animating)) cancelScheduledFrame();
        }

        function advanceSpring(state, dt) {
            // The chosen spring is overdamped (DAMPING² > 4 * MASS * STIFFNESS).
            // Its closed-form solution is independent of display refresh rate and
            // keeps current velocity continuous when the pointer changes target.
            const distance = state.current - state.target;
            const slowAmplitude = (state.velocity - FAST_RATE * distance)
                / (SLOW_RATE - FAST_RATE);
            const fastAmplitude = distance - slowAmplitude;
            const slowPart = slowAmplitude * Math.exp(SLOW_RATE * dt);
            const fastPart = fastAmplitude * Math.exp(FAST_RATE * dt);
            state.current = state.target + slowPart + fastPart;
            state.velocity = SLOW_RATE * slowPart + FAST_RATE * fastPart;
        }

        function tick(time) {
            frameId = null;
            const timestamp = Number.isFinite(time) ? time : now();
            // A suspended tab must not make the spring leap past its target.
            const dt = lastTime === null ? 1 / 60
                : Math.min(Math.max((timestamp - lastTime) / 1000, 0), 0.05);
            lastTime = timestamp;
            for (const state of states.values()) {
                if (!state.animating) continue;
                if (isReducedMotion()) {
                    state.current = state.target;
                    state.velocity = 0;
                } else {
                    advanceSpring(state, dt);
                }
                if (
                    Math.abs(state.target - state.current) <= POSITION_EPSILON
                    && Math.abs(state.velocity) <= VELOCITY_EPSILON
                ) {
                    state.current = state.target;
                    state.velocity = 0;
                    state.animating = false;
                    render(state);
                    complete(state);
                } else {
                    render(state);
                }
            }
            const moving = [...states.values()].some((state) => state.animating);
            if (moving && requestFrame) frameId = requestFrame(tick);
            else lastTime = null;
        }

        function schedule() {
            if (frameId === null && requestFrame) {
                if (lastTime === null) lastTime = now();
                frameId = requestFrame(tick);
            }
        }

        function set(element, targetY, { immediate = false, onComplete = null } = {}) {
            if (!element || !element.style || !Number.isFinite(targetY)) return;
            let state = states.get(element);
            if (!state) {
                state = {
                    style: element.style,
                    original: readTransform(element.style),
                    current: 0,
                    target: 0,
                    velocity: 0,
                    animating: false,
                    onComplete: null
                };
                states.set(element, state);
            }
            state.target = targetY;
            state.onComplete = onComplete;
            if (immediate || !requestFrame || isReducedMotion()) {
                state.current = targetY;
                state.velocity = 0;
                state.animating = false;
                render(state);
                complete(state);
                stopIfIdle();
                return;
            }
            if (Math.abs(state.current - targetY) <= POSITION_EPSILON && !state.animating) {
                state.current = targetY;
                render(state);
                complete(state);
                stopIfIdle();
                return;
            }
            // Retarget from the actual position and velocity; do not restart an
            // easing transition from the row's former target.
            state.animating = true;
            schedule();
        }

        function getCurrentY(element) {
            return states.get(element)?.current || 0;
        }

        function getTargetY(element) {
            return states.get(element)?.target || 0;
        }

        function has(element) {
            return states.has(element);
        }

        function finish(element) {
            const state = states.get(element);
            if (!state) return;
            state.current = state.target;
            state.velocity = 0;
            state.animating = false;
            render(state);
            complete(state);
            stopIfIdle();
        }

        function clear(element, { restore: shouldRestore = true } = {}) {
            const state = states.get(element);
            if (!state) return;
            state.animating = false;
            state.onComplete = null;
            if (shouldRestore) restore(state);
            states.delete(element);
            stopIfIdle();
        }

        function reset() {
            cancelScheduledFrame();
            for (const state of states.values()) restore(state);
            states.clear();
        }

        function dispose() {
            reset();
        }

        return { set, getCurrentY, getTargetY, has, finish, clear, reset, dispose };
    }

    globalThis.NSM_CREATE_CONTENT_DRAG_MOTION = createContentDragMotion;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentDragMotion;
    }
})();
