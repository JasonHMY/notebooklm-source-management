const createContentDragReflow = require('../../src/content/content-drag-reflow.js');

// Manual DOM mock matching the rest of this project's content tests
// (see content-drag-multi.test.js makeDocument). Avoids adding a jsdom dep.
//
// items input shape (array): [{ key, attr, height }]
//   - key: string identifier
//   - attr: 'data-source-key' | 'data-group-id'
//   - height: number used as offsetHeight
// Returns { root, items } where:
//   - root.querySelector resolves [data-source-key="K"] or [data-group-id="K"]
//   - items[key] is a stable mock element with offsetHeight + style + classList
function makeRoot(items) {
    const byKey = Object.create(null);
    const normalized = Array.isArray(items)
        ? items
        : Object.entries(items || {}).map(([key, v]) => ({
            key,
            attr: v.attr,
            height: typeof v.offsetHeight === 'number' ? v.offsetHeight : v.height
        }));

    for (const { key, attr, height } of normalized) {
        const classes = new Set();
        byKey[key] = {
            attr,
            offsetHeight: typeof height === 'number' ? height : 0,
            style: { transform: '' },
            classList: {
                add(name) { classes.add(name); },
                remove(name) { classes.delete(name); },
                contains(name) { return classes.has(name); }
            }
        };
    }

    const root = {
        querySelector: jest.fn((selector) => {
            const match = selector.match(/^\[(data-source-key|data-group-id)="(.*)"\]$/);
            if (!match) return null;
            const [, attr, key] = match;
            const item = byKey[key];
            if (!item || item.attr !== attr) return null;
            return item;
        })
    };

    return { root, items: byKey };
}

describe('content-drag-reflow factory', () => {
    test('exposes createDragSession factory', () => {
        const api = createContentDragReflow();
        expect(api.TRANSITION_MS).toBe(180);
        expect(api.createDragSession).toBeInstanceOf(Function);
        const session = api.createDragSession();
        expect(session.draggedKeys).toBeInstanceOf(Set);
        expect(session.itemHeights).toBeInstanceOf(Map);
        expect(session.shiftedItems).toBeInstanceOf(Map);
        expect(session.totalDraggedHeight).toBe(0);
        expect(session.currentIntent).toBeNull();
    });
});

describe('prepareDragSession', () => {
    let api;
    beforeEach(() => {
        api = createContentDragReflow();
    });

    test('measures and caches heights for dragged items', () => {
        const { root } = makeRoot([
            { key: 'k1', attr: 'data-source-key', height: 48 },
            { key: 'k2', attr: 'data-source-key', height: 60 }
        ]);

        const session = api.prepareDragSession({
            draggedKeys: ['k1', 'k2'],
            rootElement: root
        });

        expect(session.draggedKeys.has('k1')).toBe(true);
        expect(session.draggedKeys.has('k2')).toBe(true);
        expect(session.itemHeights.get('k1')).toBe(48);
        expect(session.itemHeights.get('k2')).toBe(60);
        expect(session.totalDraggedHeight).toBe(108);
    });

    test('falls back to 0 height when element missing', () => {
        const { root } = makeRoot([]);
        const session = api.prepareDragSession({
            draggedKeys: ['missing'],
            rootElement: root
        });
        expect(session.itemHeights.get('missing')).toBe(0);
        expect(session.totalDraggedHeight).toBe(0);
    });

    test('supports group ids via data-group-id selector', () => {
        const { root } = makeRoot([
            { key: 'g1', attr: 'data-group-id', height: 80 }
        ]);

        const session = api.prepareDragSession({
            draggedKeys: ['g1'],
            rootElement: root
        });
        expect(session.itemHeights.get('g1')).toBe(80);
        expect(session.totalDraggedHeight).toBe(80);
    });
});

describe('foldDraggedItems / unfoldDraggedItems', () => {
    let api;
    beforeEach(() => {
        api = createContentDragReflow();
    });

    test('foldDraggedItems sets inline height=0 + opacity=0 + class', () => {
        const { root, items } = makeRoot([
            { key: 'k1', attr: 'data-source-key', height: 48 }
        ]);
        const session = api.prepareDragSession({ draggedKeys: ['k1'], rootElement: root });
        api.foldDraggedItems({ session, rootElement: root });
        expect(items.k1.style.height).toBe('0px');
        expect(items.k1.style.opacity).toBe('0');
        expect(items.k1.classList.contains('sp-drag-folded')).toBe(true);
    });

    test('unfoldDraggedItems restores height/opacity and removes class', () => {
        const { root, items } = makeRoot([
            { key: 'k1', attr: 'data-source-key', height: 48 }
        ]);
        const session = api.prepareDragSession({ draggedKeys: ['k1'], rootElement: root });
        api.foldDraggedItems({ session, rootElement: root });
        api.unfoldDraggedItems({ session, rootElement: root });
        expect(items.k1.style.height).toBe('');
        expect(items.k1.style.opacity).toBe('');
        expect(items.k1.classList.contains('sp-drag-folded')).toBe(false);
    });
});

describe('computeReflow', () => {
    let api;
    beforeEach(() => {
        api = createContentDragReflow();
    });

    function makeFourSourceRoot() {
        return makeRoot([
            { key: 'a', attr: 'data-source-key', height: 48 },
            { key: 'b', attr: 'data-source-key', height: 48 },
            { key: 'c', attr: 'data-source-key', height: 48 },
            { key: 'd', attr: 'data-source-key', height: 48 }
        ]);
    }

    test('single source dragged: items after insertIndex shift by itemHeight', () => {
        const { root } = makeFourSourceRoot();
        const session = api.prepareDragSession({ draggedKeys: ['a'], rootElement: root });
        const shifts = api.computeReflow({
            session, insertIndex: 2,
            siblingKeys: ['a', 'b', 'c', 'd'], rootElement: root
        });
        // 'a' is dragged → skipped
        // 'b' at idx 1 < 2 → not shifted
        // 'c' at idx 2 >= 2 → shift by 48
        // 'd' at idx 3 >= 2 → shift by 48
        expect(shifts.get('a')).toBeUndefined();
        expect(shifts.get('b')).toBeUndefined();
        expect(shifts.get('c')).toBe(48);
        expect(shifts.get('d')).toBe(48);
    });

    test('multi source dragged: shift by N * itemHeight', () => {
        const { root } = makeFourSourceRoot();
        const session = api.prepareDragSession({ draggedKeys: ['a', 'b'], rootElement: root });
        const shifts = api.computeReflow({
            session, insertIndex: 3,
            siblingKeys: ['a', 'b', 'c', 'd'], rootElement: root
        });
        expect(shifts.get('a')).toBeUndefined();
        expect(shifts.get('b')).toBeUndefined();
        expect(shifts.get('c')).toBeUndefined();
        expect(shifts.get('d')).toBe(96);
    });

    test('insertIndex past end: nothing shifted', () => {
        const { root } = makeFourSourceRoot();
        const session = api.prepareDragSession({ draggedKeys: ['a'], rootElement: root });
        const shifts = api.computeReflow({
            session, insertIndex: 4,
            siblingKeys: ['a', 'b', 'c', 'd'], rootElement: root
        });
        expect(shifts.size).toBe(0);
    });
});

describe('applyReflow / clearReflow', () => {
    let api;
    beforeEach(() => {
        api = createContentDragReflow();
    });

    test('applyReflow writes transform and tracks shiftedItems', () => {
        const { root, items } = makeRoot([{ key: 'x', attr: 'data-source-key', height: 48 }]);
        const session = api.prepareDragSession({ draggedKeys: [], rootElement: root });
        const shifts = new Map([['x', 48]]);
        api.applyReflow({ session, shifts, rootElement: root });

        expect(items.x.style.transform).toBe('translateY(48px)');
        expect(items.x.classList.contains('sp-drop-shift')).toBe(true);
        expect(session.shiftedItems.get('x')).toBe(48);
    });

    test('applyReflow diffs: unchanged items are not rewritten', () => {
        const { root, items } = makeRoot([{ key: 'x', attr: 'data-source-key', height: 48 }]);
        const session = api.prepareDragSession({ draggedKeys: [], rootElement: root });
        const shifts1 = new Map([['x', 48]]);
        api.applyReflow({ session, shifts: shifts1, rootElement: root });

        // Externally clobber transform; applyReflow with identical shifts should NOT re-write
        items.x.style.transform = 'translateY(999px)';
        api.applyReflow({ session, shifts: shifts1, rootElement: root });
        expect(items.x.style.transform).toBe('translateY(999px)');
    });

    test('applyReflow clears removed items', () => {
        const { root, items } = makeRoot([
            { key: 'x', attr: 'data-source-key', height: 48 },
            { key: 'y', attr: 'data-source-key', height: 48 }
        ]);
        const session = api.prepareDragSession({ draggedKeys: [], rootElement: root });
        api.applyReflow({ session, shifts: new Map([['x', 48], ['y', 48]]), rootElement: root });
        api.applyReflow({ session, shifts: new Map([['x', 48]]), rootElement: root });

        expect(items.x.style.transform).toBe('translateY(48px)');
        expect(items.y.style.transform).toBe('');
        expect(items.y.classList.contains('sp-drop-shift')).toBe(false);
    });

    test('clearReflow zeros all transforms', () => {
        const { root, items } = makeRoot([{ key: 'x', attr: 'data-source-key', height: 48 }]);
        const session = api.prepareDragSession({ draggedKeys: [], rootElement: root });
        api.applyReflow({ session, shifts: new Map([['x', 48]]), rootElement: root });
        api.clearReflow({ session, rootElement: root });

        expect(items.x.style.transform).toBe('');
        expect(items.x.classList.contains('sp-drop-shift')).toBe(false);
        expect(session.shiftedItems.size).toBe(0);
    });
});

describe('findItemElement source-key escaping (security)', () => {
    let originalCSS;
    beforeEach(() => { originalCSS = globalThis.CSS; });
    afterEach(() => {
        if (originalCSS === undefined) delete globalThis.CSS;
        else globalThis.CSS = originalCSS;
    });

    test('escapes the untrusted source key via CSS.escape, not a quote-only replace', () => {
        // NotebookLM-derived source keys can contain ], backslashes, or leading
        // digits that break a `[data-source-key="..."]` selector. A hand-rolled
        // replace(/"/g) only escapes quotes; CSS.escape covers the full grammar.
        // Sentinel-wrap CSS.escape so we can assert the selector is built from it.
        globalThis.CSS = { escape: jest.fn((s) => `ESC<${s}>`) };
        const api = createContentDragReflow();
        const el = { style: { transform: '' }, classList: { add() {}, remove() {} } };
        const querySelector = jest.fn(() => el);
        // Empty session + non-empty shifts → Phase 2 actually resolves the element.
        api.applyReflow({
            session: { shiftedItems: new Map() },
            shifts: new Map([['a]b', 40]]),
            rootElement: { querySelector }
        });
        expect(globalThis.CSS.escape).toHaveBeenCalledWith('a]b');
        expect(querySelector).toHaveBeenCalledWith('[data-source-key="ESC<a]b>"]');
    });
});

describe('group-children left-guide extension while folded', () => {
    function makeGroupChildEl(initialParentClasses) {
        const parentClasses = new Set(initialParentClasses);
        const parent = {
            classList: {
                add: (c) => parentClasses.add(c),
                remove: (c) => parentClasses.delete(c),
                contains: (c) => parentClasses.has(c)
            },
            style: { setProperty: jest.fn(), removeProperty: jest.fn() }
        };
        const elClasses = new Set(['source-item']);
        const el = {
            style: { height: '', opacity: '' },
            classList: {
                add: (c) => elClasses.add(c),
                remove: (c) => elClasses.delete(c),
                contains: (c) => elClasses.has(c)
            },
            parentElement: parent
        };
        return { parent, el };
    }

    test('foldDraggedItems extends the parent group-children guide by the folded height', () => {
        const api = createContentDragReflow();
        const { parent, el } = makeGroupChildEl(['group-children']);
        const session = api.createDragSession();
        session.draggedKeys.add('k1');
        session.itemHeights.set('k1', 48);
        const rootElement = { querySelector: (sel) => (sel.includes('k1') ? el : null) };

        api.foldDraggedItems({ session, rootElement });

        // The dragged row collapses (layout height removed from the folder)...
        expect(el.style.height).toBe('0px');
        // ...so the parent folder gets a guide-extension marker + the folded height,
        // letting the left bar (border-left, blue on hover) span the full folder via
        // a CSS ::before instead of tracking the now-shortened layout height.
        expect(parent.classList.contains('sp-drag-guide')).toBe(true);
        expect(parent.style.setProperty).toHaveBeenCalledWith('--sp-fold-comp', '48px');
    });

    test('unfoldDraggedItems clears the guide extension from tracked parents', () => {
        const api = createContentDragReflow();
        const { parent, el } = makeGroupChildEl(['group-children', 'sp-drag-guide']);
        const session = api.createDragSession();
        session.draggedKeys.add('k1');
        session.guidedParents = [parent];
        const rootElement = { querySelector: () => el };

        api.unfoldDraggedItems({ session, rootElement });

        expect(parent.classList.contains('sp-drag-guide')).toBe(false);
        expect(parent.style.removeProperty).toHaveBeenCalledWith('--sp-fold-comp');
    });
});
