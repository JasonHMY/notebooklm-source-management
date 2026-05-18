const createContentDiagnostics = require('../../src/content/content-diagnostics.js');

describe('content diagnostics helper', () => {
    it('clones native label import summaries without sharing label objects', () => {
        const helper = createContentDiagnostics();
        const summary = {
            labelCount: 1,
            labels: [{ title: 'Private Label', sourceCount: 2 }]
        };

        const clone = helper.cloneNativeLabelImportSummary(summary);
        expect(clone).toEqual(summary);
        expect(clone).not.toBe(summary);
        expect(clone.labels[0]).not.toBe(summary.labels[0]);
    });

    it('builds sanitized content error log details', () => {
        const helper = createContentDiagnostics();
        const error = new Error('boom');

        expect(helper.getContentErrorLogDetails({
            error,
            filename: 'content.js',
            lineno: 12,
            colno: 3
        })).toEqual({
            error,
            sourcePresent: true,
            line: 12,
            column: 3
        });

        const fallback = helper.getContentErrorLogDetails({ message: 'fallback' });
        expect(fallback.error).toBeInstanceOf(Error);
        expect(fallback.error.message).toBe('fallback');
        expect(fallback.sourcePresent).toBe(false);
    });

    it('builds unhandled rejection log details and stringifies diagnostics', () => {
        const helper = createContentDiagnostics();
        const error = new Error('reject');

        expect(helper.getUnhandledRejectionLogDetails({ reason: error })).toEqual({ error });
        const fallback = helper.getUnhandledRejectionLogDetails({ reason: 'bad' });
        expect(fallback.error).toBeInstanceOf(Error);
        expect(fallback.error.message).toBe('bad');
        expect(helper.stringifyDiagnostics({ ok: true })).toBe(JSON.stringify({ ok: true }, null, 2));
    });
});
