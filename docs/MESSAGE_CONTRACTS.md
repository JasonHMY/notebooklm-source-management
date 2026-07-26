# Message Contracts

This document records the extension message boundary between popup, content scripts, and the background service worker. Keep it updated whenever a message type, response shape, sender validation rule, or storage key prefix changes.

## Background messages

```text
Popup/content -> background
├── GET_EXTENSION_ENABLED
├── SET_EXTENSION_ENABLED
├── OPEN_OR_FOCUS_NOTEBOOKLM
├── OPEN_WEB_STORE_FEEDBACK
├── LOAD_PREFERENCES
├── SAVE_PREFERENCES
├── SAVE_STATE
├── LOAD_STATE
├── LOAD_STATE_HISTORY
├── APPEND_STATE_HISTORY
├── APPEND_DEVELOPER_LOG
├── LOAD_DEVELOPER_LOGS
└── CLEAR_DEVELOPER_LOGS
```

Notebook-scoped storage messages require a sender tab whose URL starts with `https://notebooklm.google.com/notebook/`. Beyond the URL prefix, `SAVE_STATE` / `LOAD_STATE` / `APPEND_STATE_HISTORY` / `LOAD_STATE_HISTORY` also require the `projectId` embedded in `request.key` (the trailing `_<id>` segment) to match the sender tab's own `/notebook/<id>`; otherwise the worker returns `unauthorized_sender`. For those state/history messages only, a bare `/notebook/` URL does not add an extra project-id rejection.

Developer-log messages use a stricter ownership rule. `APPEND_DEVELOPER_LOG` / `LOAD_DEVELOPER_LOGS` / `CLEAR_DEVELOPER_LOGS` require a non-empty project id parsed from the sender tab URL and require `request.key` to equal `sourcesPlusDeveloperLogs_<projectId>` exactly. Suffix matches, longer shared-prefix ids, extra key segments, cross-notebook keys, and a bare `/notebook/` URL all return `unauthorized_sender` before any storage read or write.

Global messages that are not notebook-state writes, such as extension enable/disable, preferences, tab focus/open, and web store feedback, are not tied to one notebook state key.

`LOAD_PREFERENCES` returns `sourcesPlusPreferences` fields such as `developerModeEnabled`, `welcomeOnboardingSeenVersion`, `whatsNewSeenVersion`, `historyRetentionLimit`, `languageOverride`, `dragMode`, `commandShortcuts`, `visibleQuickViewKinds`, and `appearance`. It also returns derived `usageState.hasExistingPluginData` and `usageState.hasStoredPreferences` booleans so content code can distinguish first-time users from users upgrading with existing local extension data. `SAVE_PREFERENCES` accepts partial preference updates and merges them with the existing stored object so toggling one preference does not clear the other stored preference fields.

`appearance` is a nested object containing visual customization preferences. Currently includes `hoverSpotlightEnabled` (boolean, default true). `SAVE_PREFERENCES` deep-merges partial `appearance` updates so the background SW preserves sibling keys when more are added.

`dragMode` is a top-level scalar enum (`classic` default / `reflow` Beta) normalized by `normalizeDragMode`; `SAVE_PREFERENCES` accepts `{ dragMode }` and merges it like other top-level scalars (unknown values fall back to `classic`).

## Storage message key rules

```text
SAVE_STATE / LOAD_STATE
└── key must start with sourcesPlusState_

LOAD_STATE_HISTORY / APPEND_STATE_HISTORY
└── key must start with sourcesPlusHistory_

APPEND_DEVELOPER_LOG / LOAD_DEVELOPER_LOGS / CLEAR_DEVELOPER_LOGS
└── key must equal sourcesPlusDeveloperLogs_<sender projectId>
```

`APPEND_STATE_HISTORY` entries may include `label` and `manual` for user-created restore points. The message type is unchanged; the background worker applies the current `historyRetentionLimit` preference when saving or loading history.

Invalid keys return:

```json
{ "success": false, "errorCode": "invalid_storage_key" }
```

Unauthorized notebook senders return:

```json
{ "success": false, "errorCode": "unauthorized_sender" }
```

## State save response

`SAVE_STATE` writes are serialized per storage key in the background worker and guarded by save revision metadata. A same-notebook `LOAD_STATE` waits for an already pending `SAVE_STATE` on that key before issuing its storage read, so it returns the persisted revision after the save settles. Loads for different notebook keys remain independent and can proceed in parallel.

Successful saves return:

```json
{
  "success": true,
  "saveRevision": 12,
  "savedAt": "2026-05-16T00:00:00.000Z",
  "storageUsageBytes": 1234,
  "storageQuotaBytes": 10485760,
  "storageUsageRatio": 0.01,
  "storageWarning": false,
  "historyEntryCount": 5,
  "historyTrimmed": false
}
```

Rejected saves use one of the shared error codes:

```text
stale_revision
storage_quota_exceeded
runtime_failure
invalid_storage_key
unauthorized_sender
```

Content scripts must not bypass explicit background rejection with a direct primary-state `chrome.storage.local.set`. A direct local fallback is considered only when runtime messaging is unavailable and `allowLocalFallback !== false`; lifecycle and import critical saves set `allowLocalFallback: false`. The fallback must reject a nonzero `_saveRevision` equal to stored state when the persistable snapshots differ, returning `equal_revision_conflict` without writing; an equivalent equal-revision retry remains idempotent.

`visibilitychange:hidden` and `pagehide` enqueue critical `SAVE_STATE` requests through this same per-key FIFO. If a normal save is already in flight, the lifecycle request waits behind it and uses the revision acknowledged by that earlier save as its `baseRevision`. The lifecycle path writes only the session recovery snapshot before dispatch and never performs a second direct primary write. If the recovery slot already contains a failed `import_ack_unknown` or `import_rollback_required` snapshot, lifecycle dispatch continues but must not replace or clear that higher-priority import recovery on either success or failure.

## Content messages

```text
Popup/background -> content
├── GET_MANAGER_STATUS
├── FOCUS_MANAGER
├── SWITCH_SOURCE_VIEW
├── ENABLE_MANAGER
└── DISABLE_MANAGER
```

`GET_MANAGER_STATUS` should report whether the manager is ready, the current reason when it is not ready, notebook/project context, and source view controls.

`SWITCH_SOURCE_VIEW` must preserve label-view selection state before clicking Gemini Notebook native view controls.

`ENABLE_MANAGER` and `DISABLE_MANAGER` toggle the in-page manager without changing stored notebook organization data.

`DISABLE_MANAGER` synchronously flushes any pending debounced state into the background save queue, then synchronously removes the manager host and interaction sources. It responds immediately without waiting for the save callback:

```json
{
  "success": true,
  "disabled": true,
  "saveStarted": true
}
```

Destroy, route teardown, panel collapse, and source-detail suspension use the same flush-before-cleanup ordering. Panel collapse and source-detail suspension additionally preserve the in-memory reattach snapshot.

## Developer log messages

Developer logging is controlled by `sourcesPlusPreferences.developerModeEnabled`. When disabled, content code should not append new logs. First-run welcome onboarding is controlled by `sourcesPlusPreferences.welcomeOnboardingSeenVersion`, and What's New dismissal is controlled by `sourcesPlusPreferences.whatsNewSeenVersion` using the same preference messages.

Log payloads are structured and sanitized before storage:

```json
{
  "id": "2026-05-16T00:00:00.000Z:1",
  "timestamp": "2026-05-16T00:00:00.000Z",
  "level": "info",
  "category": "source_sync",
  "event": "native_label_preview_ready",
  "notebookId": "project-id",
  "details": {
    "labelCount": 3,
    "sourceCount": 12
  }
}
```

Developer logs are bounded to 500 entries and approximately 512 KB per notebook.

`APPEND_DEVELOPER_LOG` and `CLEAR_DEVELOPER_LOGS` share one FIFO per exact developer-log key. This prevents two concurrent append read-modify-write operations from dropping an entry and preserves append/clear arrival order. `LOAD_DEVELOPER_LOGS` waits for the pending task on its own key before reading, while operations for different notebook keys remain independent and may run in parallel.
