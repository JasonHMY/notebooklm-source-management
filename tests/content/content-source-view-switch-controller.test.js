const createContentSourceViewSwitchController = require('../../src/content/content-source-view-switch-controller.js');

describe('content source view switch controller helper', () => {
    it('normalizes source view targets and concrete values', () => {
        const helper = createContentSourceViewSwitchController();

        expect(helper.normalizeSourceViewSwitchTarget('label')).toBe('label');
        expect(helper.normalizeSourceViewSwitchTarget('unknown')).toBe('list');
        expect(helper.isConcreteSourceViewKind('list')).toBe(true);
        expect(helper.isConcreteSourceViewKind('label')).toBe(true);
        expect(helper.isConcreteSourceViewKind('unknown')).toBe(false);
    });

    it('builds display and status fields without mutating native info', () => {
        const helper = createContentSourceViewSwitchController();
        const nativeInfo = { kind: 'label', confidence: 8, labelRows: 2 };
        const displayInfo = helper.buildSourceDisplayViewInfo(nativeInfo, 'list');

        expect(displayInfo).toMatchObject({
            kind: 'list',
            displayKind: 'list',
            detectedKind: 'label',
            detectedConfidence: 8,
            displayOverride: true,
            labelRows: 2
        });
        expect(nativeInfo.kind).toBe('label');
        expect(helper.buildSourceViewStatusFields(nativeInfo, displayInfo)).toEqual({
            sourceViewKind: 'list',
            sourceViewDisplayKind: 'list',
            detectedSourceViewKind: 'label',
            sourceViewConfidence: 8
        });
    });

    it('records started and completed view switch attempts', () => {
        const helper = createContentSourceViewSwitchController();
        const started = helper.createLastViewSwitchAttempt({ targetViewKind: 'label' }, () => 'start');
        const finished = helper.finishViewSwitchAttempt(
            started,
            { success: true, viewKind: 'label', sourceViewDisplayKind: 'label', displayOverride: false },
            100,
            () => 175,
            () => 'end'
        );

        expect(started).toEqual({ attemptedAt: 'start', targetViewKind: 'label' });
        expect(finished).toMatchObject({
            attemptedAt: 'start',
            success: true,
            targetViewKind: 'label',
            sourceViewDisplayKind: 'label',
            completedAt: 'end',
            durationMs: 75
        });
    });
});
