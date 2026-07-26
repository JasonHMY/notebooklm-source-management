# Storage Schema

This document defines the extension storage contract. Keep it updated whenever a storage key, persisted field, migration, import/export shape, or privacy boundary changes.

## Storage keys

```text
chrome.storage.local
├── extensionEnabled
│   └── Global boolean. Missing means enabled.
├── sourcesPlusState_<projectId>
│   └── Per-notebook primary manager state.
├── sourcesPlusState_<projectId>__backup
│   └── Per-notebook backup snapshot written with primary state.
├── sourcesPlusHistory_<projectId>
│   └── Per-notebook bounded history snapshots.
├── sourcesPlusPreferences
│   └── Global preferences: developer mode, onboarding/update dismissal, history retention, language override, command shortcuts, quick view button visibility, and appearance customization.
└── sourcesPlusDeveloperLogs_<projectId>
    └── Per-notebook bounded developer logs.
```

`<projectId>` is derived from the notebook URL in Gemini Notebook. Notebook-scoped writes normally go through the background service worker, which validates the sender and key prefix before touching storage.

`src/utils/storage-contract.js` is the executable source of truth for the current
schema/import versions, all four notebook-scoped key prefixes, exact key builders,
sender-to-key ownership checks, and schema compatibility classification. It is a
pure frozen factory with no DOM, Chrome API, logging, or mutable runtime dependency;
content scripts and the background service worker load the same contract.

### Recovery snapshot (sessionStorage)

Separately from `chrome.storage.local`, critical saves write a per-tab recovery snapshot to `sessionStorage` under `sourcesPlusRecovery_<projectId>`, holding `{ snapshot, baseRevision, createdAt, reason, clientSaveId, failed }`. It is a last-resort fallback (e.g. a lifecycle save interrupted by runtime unavailability or quota pressure) so a tab can recover unsaved organization after an interruption. `visibilitychange:hidden` and `pagehide` enqueue a critical `SAVE_STATE` through the same background per-key FIFO as normal saves; they never directly overwrite the primary or backup key.

Every queued save captures an immutable notebook-bound context: project id, primary state key, recovery key, manager instance token, client save id, save snapshot, and recovery snapshot. Revision memory is tracked per primary state key. Async completion may update only that key's revision/recovery records, and may update visible save status only while the same project and manager instance are still current. A response is a confirmed background acknowledgement only when it contains boolean `success: true`; an empty or malformed response is `empty_response` and cannot clear recovery.

Critical import saves use the pre-import snapshot as their recovery snapshot:

- `import_pending`: written synchronously when the save is enqueued, before it waits behind older saves or dispatches a background request.
- `import_rollback_required`: the background explicitly rejected the import save, so runtime is rolled back and the pre-import snapshot remains available.
- `import_ack_unknown`: runtime messaging threw, failed, or returned an empty/malformed acknowledgement, so commit state is ambiguous; runtime is rolled back and recovery remains available for explicit reconciliation even if primary data appears equivalent or newer.

Only confirmed background success clears a critical recovery snapshot. A local fallback result is insufficient. Lifecycle and import critical saves disable local fallback entirely; local fallback is considered only when runtime messaging is unavailable and the caller has not set `allowLocalFallback: false`. A failed `import_ack_unknown` or `import_rollback_required` recovery has higher priority than a later lifecycle snapshot: `visibilitychange:hidden` / `pagehide` still dispatch their background save, but neither lifecycle success nor failure may replace or clear that existing import recovery.

### Save ordering and lifecycle teardown

All primary-state saves normally enter the background `SAVE_STATE` FIFO. A lifecycle save uses:

```json
{
  "immediate": true,
  "critical": true,
  "recordUndo": false,
  "reason": "page_lifecycle",
  "allowLocalFallback": false
}
```

When a manager is disabled, destroyed, detached for panel collapse/source detail, or torn down during SPA routing, cleanup synchronously flushes the pending debounce into the save queue before synchronously removing the host and event sources. Cleanup does not wait for the background acknowledgement, so the UI disappears immediately while the captured save Promise continues settling. This ordering prevents a pending mutation from being canceled and prevents new UI interactions while that save is in flight.

The emergency local fallback compares `_saveRevision` before writing. A lower incoming revision is stale. A nonzero revision equal to storage but carrying a different persistable snapshot is rejected as `equal_revision_conflict` without changing primary or backup; an equivalent equal-revision retry remains idempotently successful.

## Global preferences schema

`sourcesPlusPreferences` is not included in notebook import/export JSON.

```json
{
  "developerModeEnabled": false,
  "welcomeOnboardingSeenVersion": 1,
  "whatsNewSeenVersion": "26.6.14",
  "historyRetentionLimit": 20,
  "languageOverride": "auto",
  "dragMode": "classic",
  "commandShortcuts": {
    "quick-view-recent": "Meta+Shift+R"
  },
  "visibleQuickViewKinds": ["all", "ungrouped", "disabled", "tag", "recent", "issues"],
  "appearance": {
    "hoverSpotlightEnabled": true
  }
}
```

- `developerModeEnabled` controls sanitized developer log collection.
- `welcomeOnboardingSeenVersion` records the latest first-run welcome modal version the user has dismissed. Missing or `0` means the current welcome modal can be shown once.
- `whatsNewSeenVersion` records the latest extension version string whose update-introduction modal the user has dismissed. Missing or an older dotted version means the current enabled What's New modal can be shown once for existing users.
- `historyRetentionLimit` controls how many `sourcesPlusHistory_<projectId>` entries are retained. Valid values are `20`, `50`, and `100`; invalid or missing values fall back to `20`.
- `languageOverride` controls extension UI language. Valid values are `auto`, `en`, `es`, and `zh_CN`; `auto` follows Chrome UI language.
- `dragMode` selects the drag-and-drop behavior. Valid values are `classic` (default — blue insertion line, loose sources land only in folders or the bottom Ungrouped bin) and `reflow` (Beta — other sources move aside and a source can be positioned anywhere at root, including between folders); any other/missing value falls back to `classic`. Switching to `classic` sweeps any positioned root sources into the Ungrouped bin (classic cannot represent them).
- `commandShortcuts` stores user-defined command palette shortcuts by command id. There are no default shortcuts; invalid command ids or malformed combos are ignored, and assigning a combo to one command removes the same combo from another command.
- `visibleQuickViewKinds` controls which quick view rail buttons render in the source panel. Valid values are `all`, `ungrouped`, `disabled`, `tag`, `recent`, and `issues`; an empty array hides the rail while command palette actions and custom shortcuts remain available.
- `appearance.hoverSpotlightEnabled` 控制 source / group header 悬浮时的蓝色 spotlight 光晕。默认 `true`，仅在显式 `false` 时关闭（只有严格 boolean false 才生效）。

`LOAD_PREFERENCES` also returns derived `usageState` booleans. They are not stored inside `sourcesPlusPreferences`; the background derives them from whether `sourcesPlusPreferences`, `sourcesPlusState_*`, `sourcesPlusHistory_*`, or `sourcesPlusDeveloperLogs_*` already exists in local storage.

## Current state schema

Current `sourcesPlusState_<projectId>` payloads use `schemaVersion: 5`.

```json
{
  "schemaVersion": 5,
  "root": [
    { "type": "group", "id": "group-id" },
    { "type": "source", "key": "source-key" }
  ],
  "groupsById": {
    "group-id": {
      "id": "group-id",
      "name": "Folder",
      "children": [{ "type": "source", "key": "source-key" }],
      "collapsed": false,
      "nativeLabelTitle": "optional native label title"
    }
  },
  "ungrouped": ["source-key"],
  "sourceStateById": {
    "source-key": {
      "enabled": true,
      "title": "source title",
      "normalizedTitle": "source title",
      "stableToken": "optional token",
      "fingerprint": "optional fingerprint",
      "identityType": "fingerprint",
      "nativeLabelTitle": "optional native label title",
      "addedAt": "optional ISO timestamp"
    }
  },
  "customHeight": null,
  "sourceViewDisplayKind": "list",
  "tagsById": {
    "tag-id": {
      "id": "tag-id",
      "label": "Tag label",
      "color": "#3366ff"
    }
  },
  "tagOrder": ["tag-id"],
  "sourceTagsById": {
    "source-key": ["tag-id"]
  }
}
```

Field notes:

- `root` is the ordered root layer: an array of `{ type: 'group', id }` and `{ type: 'source', key }` entries (same shape as `groupsById[id].children`). Root-level folders and positioned sources interleave in display order.
- `groupsById` is the full group map. Group `children` must be treated defensively as an array; legacy or imported data can omit it.
- `ungrouped` is the bottom "unsorted" bin (`string[]` of source keys). A root-level source appears in EITHER `root` (positioned) XOR `ungrouped` (bin), never both. New imports default to the bin.
- `sourceStateById` stores metadata needed to remap sources after Gemini Notebook DOM changes.
- `sourceStateById[sourceKey].addedAt` stores when the extension first recognized a source. It is optional for legacy sources and powers the built-in Recent quick view; missing values must not be backfilled as recent during migration.
- `nativeLabelTitle` marks sources or groups that came from Gemini Notebook native label import. Ordinary user folders with the same visible name must not be treated as native labels unless this field is present.
- `sourceViewDisplayKind` stores the last list/label view used in this notebook. Missing or invalid values are ignored so legacy state does not force a view switch.
- `tagsById`, `tagOrder`, and `sourceTagsById` are optional in legacy data and must be normalized on load.
- `_saveRevision` (number) and `_savedAt` (ISO string) are internal metadata injected into every persisted snapshot on save (omitted from the example above). They drive the background revision guard, the primary/backup preference choice, and the history dedup signature.

## Migrations

```text
schemaVersion 1
└── Legacy state with enabledMap and no sourceStateById/tag fields.

schemaVersion 2
└── Adds sourceStateById but no tag fields.

schemaVersion 3
└── Adds tagsById, tagOrder, sourceTagsById, current source identity metadata, and optional sourceViewDisplayKind view memory.

schemaVersion 4
└── Adds optional sourceStateById[sourceKey].addedAt for Recent quick view filtering.

schemaVersion 5
└── Replaces the flat `groups: string[]` with `root: ({ type:'group', id } | { type:'source', key })[]`,
    enabling root-level sources to be positioned between folders. Migration 4→5:
    `root = (groups || []).map(id => ({ type: 'group', id }))`, then drop `groups`;
    `ungrouped` is unchanged. Applied to the primary snapshot, `__backup`, and every
    `sourcesPlusHistory_<projectId>` entry on load (history entries may still be v4 or older).
    Older extension builds reading v5 data will not recognize `root` (root-level folders
    appear to vanish) — accepted one-way risk of a schema bump.
```

Load paths normalize older schemas to the current runtime shape and mark `pendingStorageUpgrade` so a later safe save rewrites current schema data.

### Schema compatibility gate

Every authoritative primary/backup candidate is classified before migration, structural repair, history inspection, or revision bookkeeping:

| Stored `schemaVersion` | Load result | Write behavior |
|---|---|---|
| Missing | Legacy state; normalize to v5 | A later safe save may rewrite it as v5. |
| Integer `1` | Legacy state; normalize to v5 | A later safe save may persist the normalized v5 state. |
| Integer `2`–`5` | Supported; normalize older versions to v5 | A later safe save may persist the normalized v5 state. |
| Integer greater than `5` | Unsupported future schema; do not normalize or apply | Set save status to `failed` with `lastError: "unsupported_schema"` and block notebook writes for this load instance. |
| Any other present value | Invalid schema; do not normalize or apply | Use the same `unsupported_schema` fail-closed write block. |

No persisted candidate (`null`) is a non-blocking empty/legacy state: nothing is
applied or migrated, and the notebook remains able to perform its first save.

The primary/backup revision and snapshot-quality comparison selects the authoritative raw candidate before this compatibility check. If that candidate is future or invalid, history repair is not inspected and no migration, repair, apply, lifecycle snapshot, or normal save runs. Save-queue entries capture the active load-scope generation: they recheck it before dispatch and again before applying completion effects, so an older queued save cannot start and an already in-flight result cannot replace `unsupported_schema`, advance the local revision, clear recovery, or emit critical-save completion feedback after the block activates. The block is scoped to the current notebook and manager load instance; loading another notebook or a new manager instance invalidates older queue entries, resets only the schema-specific failed status to idle, and resumes saves without clearing unrelated save metadata. A future schema is never automatically downgraded and written back.

## Backup and history

- Primary saves write both `sourcesPlusState_<projectId>` and `sourcesPlusState_<projectId>__backup`.
- Background save logic chooses the preferred stored state from primary/backup by revision metadata and content quality.
- `sourcesPlusHistory_<projectId>` is bounded by `sourcesPlusPreferences.historyRetentionLimit` and used for version history and repair recovery.
- History entries can include `label?: string` and `manual?: boolean` for named restore points. Routine retention trimming preserves manual restore points before older automatic snapshots; if manual entries alone exceed the selected limit, the oldest manual entries are trimmed. Emergency quota trimming is stricter: it preserves every manual restore point plus only the newest automatic snapshot, in the original history order. If that protected set still exceeds quota, the growth write is rejected rather than deleting manual restore points.
- Page lifecycle saves write session recovery first and then enter background `SAVE_STATE`; they do not use direct local primary fallback.
- Quota guard: when projected `chrome.storage.local` usage is over the critical ratio (`STORAGE_CRITICAL_RATIO`, 0.95), `SAVE_STATE` first applies the protected emergency history trim, then rejects writes that would **grow** the stored snapshot (`storage_quota_exceeded`). `APPEND_STATE_HISTORY` applies the same trim and rejects instead of overwriting manual restore points if the protected set remains critical. Writes that shrink or keep the primary snapshot size (e.g. deleting a source to free space) are allowed through even while critical, so quota exhaustion is never a hard lock the user cannot escape.

## Privacy boundary

Persisted state intentionally contains source titles, folder names, tag labels, stable tokens, fingerprints, and organization metadata. Treat these as private Gemini Notebook organization data.

Diagnostics and developer logs must stay more restrictive:

- Do not record source titles, source body text, tag labels, group names, full import/export JSON, long DOM text, or raw private URLs.
- Prefer counts, booleans, reason codes, source keys, and hashes.
- If an `Error` is logged, store only name, message, and a short stack hash.

## Import/export boundary

Settings export/import can include organization metadata, source titles, group names, tag labels, and source identifiers. It must continue to enforce file/text size limits, count limits, tree depth limits, cycle checks, source remapping, and tag normalization before applying imported data.

Exports use this exact envelope:

```json
{
  "format": "notebooklm-source-management-config",
  "formatVersion": 1,
  "data": {}
}
```

Imports remain compatible with a bare raw-state object when none of `format`, `formatVersion`, or `data` is present. If any one of those envelope markers is present, all three must be valid: the exact format string above, integer `formatVersion: 1`, and an object `data` payload. Unknown or incomplete envelopes are rejected rather than reinterpreted as bare state. Imported state then passes the same schema gate: a missing version or version `1` is legacy, integer versions `2`–`5` are supported and normalizable, and future or invalid versions are rejected. Rejecting an imported config does not set the notebook-scoped write block because the imported payload is not authoritative stored state.

Applying an import is atomic from the runtime user's perspective. Before any imported mutation, the manager clones its current persistable snapshot, records history, and writes the import backup. It then applies the imported runtime state and issues a critical background save with the cloned pre-import snapshot as recovery. A deferred apply, thrown save, explicit save failure, or ambiguous acknowledgement restores the complete pre-import runtime state, including clearing an imported inline height when the prior `customHeight` was `null`. Failure results expose only the declared import reasons (`deferred`, `rollback_failed`, `storage_quota_exceeded`, `import_ack_unknown`, or `save_failed`), and never display the import success action.
