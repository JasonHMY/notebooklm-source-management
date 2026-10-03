const createContentDragMotion = require('../../src/content/content-drag-motion.js');
const createContentDragReflow = require('../../src/content/content-drag-reflow.js');

function makeClock() {
    let time = 0;
    let nextId = 1;
    const callbacks = new Map();
    return {
        requestAnimationFrame: (callback) => {
            const id = nextId++;
            callbacks.set(id, callback);
            return id;
        },
        cancelAnimationFrame: (id) => callbacks.delete(id),
        now: () => time,
        advance: (ms = 16) => {
            time += ms;
            const current = [...callbacks.values()];
            callbacks.clear();
            current.forEach((callback) => callback(time));
        },
        get pending() { return callbacks.size; }
    };
}

function makeElement(initial = '') {
    const values = new Map(initial ? [['transform', { value: initial, priority: 'important' }]] : []);
    const style = {
        getPropertyValue: (name) => values.get(name)?.value || '',
        getPropertyPriority: (name) => values.get(name)?.priority || '',
        setProperty: (name, value, priority = '') => values.set(name, { value, priority }),
        removeProperty: (name) => values.delete(name)
    };
    Object.defineProperty(style, 'transform', {
        get: () => style.getPropertyValue('transform')
    });
    return { style };
}

test('spring moves toward the target over shared frames and preserves velocity on retarget', () => {
    const clock = makeClock();
    const motion = createContentDragMotion(clock);
    const a = makeElement();
    const b = makeElement();
    motion.set(a, 60);
    motion.set(b, 30);
    expect(clock.pending).toBe(1);
    expect(motion.getCurrentY(a)).toBe(0);
    clock.advance();
    const first = motion.getCurrentY(a);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(60);
    expect(motion.getCurrentY(b)).toBeGreaterThan(0);
    motion.set(a, -20);
    expect(motion.getCurrentY(a)).toBe(first);
    clock.advance();
    expect(motion.getCurrentY(a)).not.toBe(-20);
    for (let i = 0; i < 100 && clock.pending; i += 1) clock.advance();
    expect(motion.getCurrentY(a)).toBe(-20);
    expect(clock.pending).toBe(0);
});

test('restores original inline transform and priority on clear, including mid-flight', () => {
    const clock = makeClock();
    const motion = createContentDragMotion(clock);
    const element = makeElement('rotate(3deg)');
    motion.set(element, 48);
    clock.advance();
    expect(element.style.transform).toContain('rotate(3deg) translateY(');
    expect(element.style.getPropertyPriority('transform')).toBe('important');
    motion.clear(element);
    expect(element.style.transform).toBe('rotate(3deg)');
    expect(element.style.getPropertyPriority('transform')).toBe('important');
    expect(clock.pending).toBe(0);
});

test('immediate and reduced-motion targets settle without scheduling frames', () => {
    const clock = makeClock();
    const motion = createContentDragMotion({ ...clock, isReducedMotion: () => true });
    const element = makeElement();
    const finished = jest.fn();
    motion.set(element, 35, { onComplete: finished });
    expect(motion.getCurrentY(element)).toBe(35);
    expect(finished).toHaveBeenCalledTimes(1);
    expect(clock.pending).toBe(0);
    motion.set(element, 0, { immediate: true });
    expect(element.style.transform).toBe('');
});

test('reset cancels in-flight frames and allows a new drag to capture a clean baseline', () => {
    const clock = makeClock();
    const motion = createContentDragMotion(clock);
    const element = makeElement();
    motion.set(element, 40);
    clock.advance();
    motion.reset();
    expect(element.style.transform).toBe('');
    expect(clock.pending).toBe(0);
    motion.set(element, -30);
    clock.advance();
    expect(motion.getCurrentY(element)).toBeLessThan(0);
});

test('reflow reports physical spring offset separately from its target slot', () => {
    const clock = makeClock();
    const reflow = createContentDragReflow(clock);
    const element = makeElement();
    element.classList = { add() {}, remove() {} };
    const rootElement = {
        querySelector: () => element,
        contains: () => true
    };
    const session = reflow.createDragSession();
    reflow.applyReflow({
        session,
        shifts: new Map([['source', 50]]),
        rootElement
    });
    expect(session.shiftedItems.get('source')).toBe(50);
    expect(reflow.getCurrentShiftY(element)).toBe(0);
    clock.advance();
    expect(reflow.getCurrentShiftY(element)).toBeGreaterThan(0);
    expect(reflow.getCurrentShiftY(element)).toBeLessThan(50);
    reflow.clearReflow({ session, rootElement, immediate: true });
    expect(reflow.getCurrentShiftY(element)).toBe(0);
    expect(element.style.transform).toBe('');
});

test.each([30, 60, 120])('%s Hz settles monotonically without overshoot', (refreshRate) => {
    const clock = makeClock();
    const motion = createContentDragMotion(clock);
    const element = makeElement();
    motion.set(element, 100);
    let previous = 0;
    let atOneTenthSecond = null;
    for (let frame = 1; frame <= refreshRate * 2 && clock.pending; frame += 1) {
        clock.advance(1000 / refreshRate);
        const current = motion.getCurrentY(element);
        expect(current).toBeGreaterThanOrEqual(previous);
        expect(current).toBeLessThanOrEqual(100);
        if (frame === refreshRate / 10) atOneTenthSecond = current;
        previous = current;
    }
    expect(atOneTenthSecond).toBeGreaterThan(0);
    expect(motion.getCurrentY(element)).toBe(100);
    expect(clock.pending).toBe(0);
});

test('equal elapsed time produces the same spring position at 30, 60 and 120 Hz', () => {
    const positions = [30, 60, 120].map((refreshRate) => {
        const clock = makeClock();
        const motion = createContentDragMotion(clock);
        const element = makeElement();
        motion.set(element, 100);
        for (let frame = 0; frame < refreshRate / 10; frame += 1) {
            clock.advance(1000 / refreshRate);
        }
        return motion.getCurrentY(element);
    });
    expect(Math.max(...positions) - Math.min(...positions)).toBeLessThan(0.001);
});

test('a suspended-tab frame advances at most 50 ms of spring time', () => {
    const clock = makeClock();
    const motion = createContentDragMotion(clock);
    const element = makeElement();
    motion.set(element, 100);
    clock.advance(1000);
    const afterLongFrame = motion.getCurrentY(element);
    expect(afterLongFrame).toBeGreaterThan(0);
    expect(afterLongFrame).toBeLessThan(60);
    clock.advance(16);
    expect(motion.getCurrentY(element)).toBeGreaterThan(afterLongFrame);
});

test('finish invokes the completion callback once and cancels pending RAF', () => {
    const clock = makeClock();
    const motion = createContentDragMotion(clock);
    const element = makeElement();
    const callback = jest.fn();
    motion.set(element, 40, { onComplete: callback });
    motion.finish(element);
    expect(motion.getCurrentY(element)).toBe(40);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(clock.pending).toBe(0);
    motion.finish(element);
    expect(callback).toHaveBeenCalledTimes(1);
});

test('clear suppresses a stale completion callback and restores inline style', () => {
    const clock = makeClock();
    const motion = createContentDragMotion(clock);
    const element = makeElement('rotate(3deg)');
    const callback = jest.fn();
    motion.set(element, 40, { onComplete: callback });
    motion.clear(element);
    clock.advance();
    expect(callback).not.toHaveBeenCalled();
    expect(clock.pending).toBe(0);
    expect(element.style.transform).toBe('rotate(3deg)');
});

test('typed reflow keeps its shift class during return spring and rapid retarget', () => {
    const clock = makeClock();
    const reflow = createContentDragReflow(clock);
    const element = makeElement();
    const classes = new Set();
    element.dataset = { sourceKey: 'source' };
    element.getAttribute = (name) => name === 'data-source-key' ? 'source' : null;
    element.classList = {
        add: (...names) => names.forEach((name) => classes.add(name)),
        remove: (...names) => names.forEach((name) => classes.delete(name)),
        contains: (name) => classes.has(name)
    };
    const rootElement = { contains: () => true };
    const sourceElements = new Map([['source', element]]);
    const session = reflow.createDragSession();
    const apply = (target) => reflow.applyReflow({
        session,
        shifts: { sources: target === null ? new Map() : new Map([['source', target]]), groups: new Map() },
        rootElement,
        sourceElements,
        groupElements: new Map()
    });

    apply(48);
    clock.advance();
    expect(reflow.getCurrentShiftY(element)).toBeGreaterThan(0);
    apply(null);
    expect(session.shiftedSourceItems.size).toBe(0);
    expect(element.classList.contains('sp-drop-shift')).toBe(true);
    clock.advance();
    apply(32);
    expect(reflow.motion.getTargetY(element)).toBe(32);
    expect(element.classList.contains('sp-drop-shift')).toBe(true);
    for (let i = 0; i < 100 && clock.pending; i += 1) clock.advance();
    expect(reflow.getCurrentShiftY(element)).toBe(32);
    expect(element.classList.contains('sp-drop-shift')).toBe(true);

    reflow.clearReflow({ session, rootElement, sourceElements, groupElements: new Map() });
    expect(element.classList.contains('sp-drop-shift')).toBe(true);
    for (let i = 0; i < 100 && clock.pending; i += 1) clock.advance();
    expect(element.classList.contains('sp-drop-shift')).toBe(false);
    expect(element.style.transform).toBe('');
});

test('immediate teardown clears a typed shift class even with RAF available', () => {
    const clock = makeClock();
    const reflow = createContentDragReflow(clock);
    const element = makeElement();
    const classes = new Set();
    element.dataset = { sourceKey: 'source' };
    element.getAttribute = (name) => name === 'data-source-key' ? 'source' : null;
    element.classList = {
        add: (...names) => names.forEach((name) => classes.add(name)),
        remove: (...names) => names.forEach((name) => classes.delete(name)),
        contains: (name) => classes.has(name)
    };
    const rootElement = { contains: () => true };
    const sourceElements = new Map([['source', element]]);
    const session = reflow.createDragSession();
    reflow.applyReflow({
        session,
        shifts: { sources: new Map([['source', 48]]), groups: new Map() },
        rootElement, sourceElements, groupElements: new Map()
    });
    clock.advance();
    reflow.clearReflow({
        session, rootElement, sourceElements, groupElements: new Map(), immediate: true
    });
    expect(element.classList.contains('sp-drop-shift')).toBe(false);
    expect(element.style.transform).toBe('');
    expect(clock.pending).toBe(0);
});
