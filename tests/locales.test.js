const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, '../_locales');
const localeIds = fs.readdirSync(LOCALES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(LOCALES_DIR, entry.name, 'messages.json')))
    .map((entry) => entry.name)
    .sort();

const localeMessages = Object.fromEntries(
    localeIds.map((localeId) => [localeId, require(path.join(LOCALES_DIR, localeId, 'messages.json'))])
);
const enMessages = localeMessages.en;

function getMessageKeys(messages) {
    return Object.keys(messages).sort();
}

function getPlaceholderSignature(messageEntry) {
    const placeholders = messageEntry && messageEntry.placeholders ? messageEntry.placeholders : {};
    return Object.keys(placeholders)
        .sort()
        .map((key) => ({
            key,
            content: placeholders[key] && placeholders[key].content ? placeholders[key].content : ''
        }));
}

function getRequiredMessageKeys() {
    return [
        'popup_badge_ready',
        'popup_badge_launcher',
        'popup_badge_attention',
        'popup_toggle_label',
        'popup_toggle_state_enabled',
        'popup_toggle_state_disabled',
        'popup_toggle_help',
        'popup_title_ready',
        'popup_body_ready',
        'popup_title_notebook_home',
        'popup_body_notebook_home',
        'popup_title_disabled',
        'popup_body_disabled',
        'popup_title_refresh_needed',
        'popup_body_refresh_needed',
        'popup_cta_open_manager',
        'popup_cta_enable_extension',
        'popup_cta_refresh_notebook',
        'popup_reason_source_panel_missing',
        'popup_reason_panel_header_missing',
        'popup_reason_manager_not_ready',
        'popup_reason_notebook_missing',
        'popup_reason_extension_disabled',
        'popup_reason_generic',
        'popup_error_invalid_storage_key',
        'ui_view_source',
        'ui_source_untitled',
        'ui_view_source_details',
        'ui_source_details_unavailable',
        'ui_group_untitled',
        'ui_no_matching_sources',
        'ui_no_tags',
        'ui_tag_delete_confirm',
        'ui_tag_filter_active',
        'ui_isolation_active'
    ].sort();
}

describe('locale message catalogs', () => {
    it('ships the expected locales', () => {
        expect(localeIds).toEqual(expect.arrayContaining(['en', 'es', 'zh_CN']));
    });

    it('keeps every locale key set in sync with English', () => {
        for (const localeId of localeIds) {
            if (localeId === 'en') continue;
            expect(getMessageKeys(localeMessages[localeId])).toEqual(getMessageKeys(enMessages));
        }
    });

    it('keeps placeholder structure aligned across locales', () => {
        for (const localeId of localeIds) {
            if (localeId === 'en') continue;
            for (const key of getMessageKeys(enMessages)) {
                expect(getPlaceholderSignature(enMessages[key])).toEqual(
                    getPlaceholderSignature(localeMessages[localeId][key])
                );
            }
        }
    });

    it('retains critical fallback and popup copy keys', () => {
        for (const localeId of localeIds) {
            const messages = localeMessages[localeId];
            for (const key of getRequiredMessageKeys()) {
                expect(messages[key]).toBeDefined();
                expect(messages[key].message).not.toBe('');
            }
        }
    });
});
