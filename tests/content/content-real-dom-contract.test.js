const fs = require('fs');
const path = require('path');

const { DEPS } = require('../../src/content/content-config.js');
const { renderCurrentDomHtml } = require('../smoke/helpers/notebooklm-fixture.js');

/**
 * Static contract for the sanitized real-DOM capture of the Gemini Notebook Sources panel.
 *
 * The detectors themselves run against this capture in a real browser, because the project has no
 * DOM implementation for Jest: see "real-DOM capture" in tests/smoke/current-dom.smoke.spec.js.
 * This file keeps the capture honest (sanitized, still has the anchors the detectors rely on) and
 * keeps the synthetic smoke fixture aligned with it.
 */
const FIXTURE_PATH = path.join(__dirname, '../fixtures/real-dom/2026-10-27-notebook.google.com.html');
const fixtureHtml = fs.readFileSync(FIXTURE_PATH, 'utf8');
const htmlWithoutComments = fixtureHtml.replace(/<!--[\s\S]*?-->/g, '');

function getAttributeValues(html, attribute) {
    return Array.from(html.matchAll(new RegExp(`\\s${attribute}="([^"]*)"`, 'g'))).map((match) => match[1]);
}

function getClassTokens(html) {
    return new Set(getAttributeValues(html, 'class').flatMap((value) => value.split(/\s+/).filter(Boolean)));
}

describe('real-DOM capture 2026-10-27', () => {
    it('documents where and when it was captured', () => {
        expect(fixtureHtml.startsWith('<!--')).toBe(true);
        const header = fixtureHtml.slice(0, fixtureHtml.indexOf('-->'));
        expect(header).toContain('notebook.google.com');
        expect(header).toContain('2026-10-27');
        expect(header).toContain('re-capture');
    });

    it('stays sanitized: fake titles, placeholder text, whitelisted attributes only', () => {
        const allowedText = new Set([
            'Fake Source 1',
            'Fake Source 2',
            'Fake Source 3',
            'N sources',
            '[TEXT]',
            'Sources',
            'Add sources',
            // Material icon ligatures.
            'side_nav',
            'add_2',
            'layers',
            'sort',
            'attach_file',
            'drive_pdf',
            'more_vert'
        ]);
        const textNodes = htmlWithoutComments
            .split(/<[^>]+>/)
            .map((text) => text.trim())
            .filter(Boolean);
        const unexpected = textNodes.filter((text) => !allowedText.has(text));
        expect(unexpected).toEqual([]);

        const allowedAttributes = new Set([
            'class', 'type', 'draggable', 'role', 'tabindex', 'aria-label', 'aria-hidden', 'aria-expanded', 'aria-haspopup'
        ]);
        const usedAttributes = new Set(
            Array.from(htmlWithoutComments.matchAll(/<[a-z][^>]*>/gi))
                .flatMap((tag) => Array.from(tag[0].matchAll(/\s([a-z][a-z0-9-]*)=/gi)).map((match) => match[1]))
        );
        expect(Array.from(usedAttributes).filter((name) => !allowedAttributes.has(name))).toEqual([]);

        const ariaLabels = getAttributeValues(htmlWithoutComments, 'aria-label');
        ariaLabels.forEach((label) => {
            expect(label).toMatch(/^(\[TEXT\]|Collapse source panel|Auto-label your sources by topic|Sort sources|Select all sources|More|(Select )?Fake Source \d)$/);
        });
    });

    it('has no stable id anchors, matching the live page', () => {
        expect(htmlWithoutComments).not.toMatch(/data-testid|data-source-id|aria-setsize|aria-rowcount|data-total-count|data-source-count/);
    });

    it('keeps the anchors the detectors rely on', () => {
        const classTokens = getClassTokens(htmlWithoutComments);
        [
            'source-panel',
            'panel-header',
            'scroll-area-desktop',
            'single-source-container',
            'source-title',
            'source-item-source-icon',
            'source-item-more-button',
            'label-auto-button',
            'label-row',
            'source-sort-button',
            'select-checkbox',
            'select-checkbox-all-sources',
            'source-stretched-button',
            'cover-subtitle-source-count'
        ].forEach((token) => expect(classTokens).toContain(token));

        expect(htmlWithoutComments.match(/class="[^"]*\bsingle-source-container\b/g)).toHaveLength(3);
        expect(htmlWithoutComments.match(/aria-label="Select Fake Source \d"/g)).toHaveLength(3);
        expect(htmlWithoutComments.match(/aria-label="More"/g)).toHaveLength(3);
        // The header auto-label button reuses the row More button class; it is the only such button
        // outside the rows, and it is a direct action, not a menu trigger.
        const autoLabelButton = htmlWithoutComments.match(/<button[^>]*label-auto-button[^>]*>/g);
        expect(autoLabelButton).toHaveLength(1);
        expect(autoLabelButton[0]).toContain('source-item-more-button');
        expect(autoLabelButton[0]).not.toContain('aria-haspopup');
        expect(htmlWithoutComments).toMatch(/class="cover-subtitle-source-count">[^<]*sources</);
    });

    it('is reachable through the configured selectors', () => {
        const classTokens = getClassTokens(htmlWithoutComments);
        expect(DEPS.moreBtn[0]).toBe('.source-item-more-button:not(.label-auto-button)');
        expect(DEPS.moreBtn).toEqual(expect.arrayContaining(['[aria-label="More options"]', '[aria-label="More"]']));
        expect(DEPS.icon[0]).toBe('mat-icon.source-item-source-icon');
        expect(DEPS.row).toContain('.single-source-container');
        expect(DEPS.title).toContain('.source-title');
        expect(classTokens).toContain('source-item-source-icon');
        expect(DEPS.panel).toContain('.source-panel');
    });
});

describe('smoke fixture "current-dom" mode', () => {
    it('keeps every class and attribute anchor of the real capture', () => {
        const syntheticHtml = renderCurrentDomHtml('contract');
        const syntheticClasses = getClassTokens(syntheticHtml);
        [
            'source-panel',
            'scroll-area-desktop',
            'single-source-container',
            'source-title',
            'source-item-source-icon',
            'source-item-more-menu-icon',
            'source-item-more-button',
            'label-auto-button',
            'label-row',
            'source-sort-button',
            'select-checkbox',
            'select-checkbox-all-sources',
            'source-stretched-button',
            'cover-subtitle-source-count'
        ].forEach((token) => expect(syntheticClasses).toContain(token));

        expect(syntheticHtml).toContain('aria-label="More"');
        expect(syntheticHtml).toContain('aria-label="Select Fake Source 1"');
        expect(syntheticHtml).toContain('<chat-panel-header>');
        expect(syntheticHtml).not.toMatch(/data-testid|data-source-id/);
    });
});
