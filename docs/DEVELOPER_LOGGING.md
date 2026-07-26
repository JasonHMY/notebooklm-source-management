# Developer Logging Standard

This extension supports an optional Developer Mode for local debugging. Developer logs are for diagnosing extension state transitions and failures; they are not telemetry and are not sent anywhere automatically.

## Entry Shape

Every developer log entry must be structured JSON with these fields:

```json
{
  "id": "2026-05-15T00:00:00.000Z:1",
  "timestamp": "2026-05-15T00:00:00.000Z",
  "level": "info",
  "category": "persistence",
  "event": "state_save_succeeded",
  "notebookId": "notebook-id",
  "details": {
    "reason": "manual",
    "sourceCount": 12
  }
}
```

- `id`: unique per runtime sequence, normally timestamp plus an incrementing counter.
- `timestamp`: ISO timestamp.
- `level`: one of `debug`, `info`, `warn`, or `error`.
- `category`: one of `settings`, `persistence`, `source_sync`, `source_action`, `native_action`, `import_export`, `view_switch`, `lifecycle`, `ui`, or `background`.
- `event`: stable snake_case event name. Do not include dynamic data in the event name. (The logger enforces this — it strips disallowed chars to `[A-Za-z0-9_.:-]`, truncates to 120 chars, and falls back to `unknown_event` when empty — so dynamic content is silently rewritten rather than rejected.)
- `notebookId`: current notebook id from Gemini Notebook, or an empty string when unavailable.
- `details`: small sanitized object with counts, ids, reasons, revisions, booleans, and result metadata.

## Privacy Rules

Developer logs are sanitized by default. Do not intentionally log:

- source titles or source document content
- group titles
- tag labels
- full import/export JSON
- DOM `textContent` blocks
- raw URLs or hrefs that may contain private query parameters
- clipboard content

When a log needs to refer to a source, use `sourceKey`, counts, or reason codes — or pass the raw values under the keys `stableToken` / `fingerprint`, which the logger hashes and renames to the output fields `stableTokenHash` / `fingerprintHash` automatically. (Passing a key literally named `stableTokenHash` is NOT auto-hashed — use the unsuffixed key.) Do not add title fallbacks for convenience.

Captured errors may include:

- `errorName`
- short `errorMessage`
- `stackHash`

Do not store raw stack traces by default.

## Retention

Developer logs are stored per notebook under `sourcesPlusDeveloperLogs_<projectId>` and are bounded to:

- at most 500 entries
- about 512 KB serialized JSON

When either limit is exceeded, oldest entries are discarded first.

## Writing New Logs

Use the content logger helper instead of writing directly to `console` or `chrome.storage.local`:

```js
developerLog('warn', 'native_action', 'delete_failed', {
    sourceKey,
    reason: 'confirm_dialog_missing',
    retryable: true
});
```

Keep events stable and details compact. If a new detail field could contain user content, hash it or omit it.

## Settings Behavior

Developer Mode is a global preference stored in `sourcesPlusPreferences`. It is not included in notebook import/export JSON.

When Developer Mode is disabled, no new developer log entries are written. Existing logs remain until the user clears them from settings.
