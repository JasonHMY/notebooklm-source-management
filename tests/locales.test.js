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
        'ui_filter_sources_v2',
        'ui_search_results_count',
        'ui_settings',
        'ui_settings_export_title',
        'ui_settings_import_title',
        'ui_settings_copy_json',
        'ui_settings_download_json',
        'ui_settings_choose_json',
        'ui_settings_preview_import',
        'ui_settings_apply_import',
        'ui_settings_import_placeholder',
        'ui_settings_import_preview_summary',
        'ui_settings_import_preview_matched',
        'ui_settings_import_preview_unmatched',
        'ui_settings_import_preview_no_unmatched',
        'ui_settings_import_preview_more',
        'ui_settings_import_empty',
        'ui_settings_import_invalid',
        'ui_settings_imported_toast',
        'ui_settings_restore_import_backup',
        'ui_settings_import_backup_unavailable',
        'ui_settings_import_backup_restore_failed',
        'ui_settings_import_backup_restored',
        'ui_settings_import_deferred',
        'ui_settings_export_copied',
        'ui_settings_export_downloaded',
        'ui_settings_export_copy_failed',
        'ui_settings_export_download_failed',
        'ui_settings_import_file_invalid',
        'ui_settings_diagnostics_title',
        'ui_settings_copy_diagnostics',
        'ui_settings_diagnostics_copied',
        'ui_settings_diagnostics_copy_failed',
        'ui_settings_developer_mode_title',
        'ui_settings_developer_mode_toggle',
        'ui_settings_developer_mode_body',
        'ui_settings_copy_developer_logs',
        'ui_settings_download_developer_logs',
        'ui_settings_clear_developer_logs',
        'ui_settings_developer_mode_enabled',
        'ui_settings_developer_mode_disabled',
        'ui_settings_developer_mode_failed',
        'ui_settings_developer_logs_copied',
        'ui_settings_developer_logs_copy_failed',
        'ui_settings_developer_logs_cleared',
        'ui_settings_developer_logs_clear_failed',
        'ui_settings_feedback_title',
        'ui_settings_feedback_body',
        'ui_settings_open_web_store_feedback',
        'ui_settings_feedback_open_failed',
        'ui_diagnostics_import_backup',
        'ui_diagnostics_developer_log_count',
        'ui_diagnostics_latest_developer_log',
        'ui_diagnostics_native_failure_history',
        'ui_diagnostics_stale_local_revision',
        'ui_diagnostics_stale_remote_revision',
        'ui_diagnostics_stale_detected_at',
        'ui_save_status_refresh',
        'ui_undo_action',
        'ui_undo_toast',
        'ui_undo_empty',
        'ui_source_untitled',
        'ui_view_source_details',
        'ui_rename_source',
        'ui_rename_source_unavailable',
        'ui_rename_source_failed',
        'ui_delete_source',
        'ui_delete_failed_source',
        'ui_delete_source_unavailable',
        'ui_delete_source_failed',
        'ui_source_details_unavailable',
        'ui_source_details_failed',
        'ui_batch_add',
        'ui_batch_add_tags_count',
        'ui_batch_remove_tags_count',
        'ui_batch_ungroup_count',
        'ui_batch_add_tags_title',
        'ui_batch_remove_tags_title',
        'ui_apply_tags',
        'ui_batch_tags_added_toast',
        'ui_batch_tags_removed_toast',
        'ui_no_tags_to_remove',
        'ui_batch_ungrouped_toast',
        'ui_batch_no_sources_changed',
        'ui_retry',
        'ui_native_action_source_unavailable',
        'ui_native_action_menu_button_missing',
        'ui_native_action_menu_item_missing',
        'ui_native_action_confirm_dialog_missing',
        'ui_native_action_confirm_button_missing',
        'ui_native_action_failed',
        'ui_move_to_ungrouped',
        'ui_keyboard_move_unavailable',
        'ui_keyboard_moved_ungrouped_toast',
        'ui_group_untitled',
        'ui_save_failed',
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
