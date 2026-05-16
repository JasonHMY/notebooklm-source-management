const createContentRuntimeState = require('../../src/content/content-runtime-state.js');

describe('content runtime state helper', () => {
    it('binds runtime context properties through getters and setters', () => {
        let currentValue = 'initial';
        const { runtimeContext, bindRuntimeProperty } = createContentRuntimeState();

        bindRuntimeProperty('value', () => currentValue, (nextValue) => {
            currentValue = nextValue;
        });

        expect(runtimeContext.value).toBe('initial');
        runtimeContext.value = 'updated';
        expect(currentValue).toBe('updated');
        expect(runtimeContext.value).toBe('updated');
    });

    it('rejects invalid runtime property definitions', () => {
        const { bindRuntimeProperty } = createContentRuntimeState();

        expect(() => bindRuntimeProperty('', () => true)).toThrow(/runtime property/i);
        expect(() => bindRuntimeProperty('missingGetter')).toThrow(/runtime property/i);
    });
});
