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
│   └── Global preferences: developer mode, onboarding/update dismissal, history retention, language override, command shortcuts, and quick view button visibility.
└── sourcesPlusDeveloperLogs_<projectId>
    └── Per-notebook bounded developer logs.
```

`<projectId>` is derived from the NotebookLM notebook URL. Notebook-scoped writes normally go through the background service worker, which validates the sender and key prefix before touching storage.

## Global preferences schema

`sourcesPlusPreferences` is not included in notebook import/export JSON.

```json
{
  "developerModeEnabled": false,
  "welcomeOnboardingSeenVersion": 1,
  "whatsNewSeenVersion": "2.7.4",
  "historyRetentionLimit": 20,
  "languageOverride": "auto",
  "commandShortcuts": {
    "quick-view-recent": "Meta+Shift+R"
  },
  "visibleQuickViewKinds": ["all", "ungrouped", "disabled", "tag", "recent", "issues"]
}
```

- `developerModeEnabled` controls sanitized developer log collection.
- `welcomeOnboardingSeenVersion` records the latest first-run welcome modal version the user has dismissed. Missing or `0` means the current welcome modal can be shown once.
- `whatsNewSeenVersion` records the latest extension version string whose update-introduction modal the user has dismissed. Missing or an older dotted version means the current enabled What's New modal can be shown once for existing users.
- `historyRetentionLimit` controls how many `sourcesPlusHistory_<projectId>` entries are retained. Valid values are `20`, `50`, and `100`; invalid or missing values fall back to `20`.
- `languageOverride` controls extension UI language. Valid values are `auto`, `en`, `es`, and `zh_CN`; `auto` follows Chrome UI language.
- `commandShortcuts` stores user-defined command palette shortcuts by command id. There are no default shortcuts; invalid command ids or malformed combos are ignored, and assigning a combo to one command removes the same combo from another command.
- `visibleQuickViewKinds` controls which quick view rail buttons render in the source panel. Valid values are `all`, `ungrouped`, `disabled`, `tag`, `recent`, and `issues`; an empty array hides the rail while command palette actions and custom shortcuts remain available.

`LOAD_PREFERENCES` also returns derived `usageState` booleans. They are not stored inside `sourcesPlusPreferences`; the background derives them from whether `sourcesPlusPreferences`, `sourcesPlusState_*`, `sourcesPlusHistory_*`, or `sourcesPlusDeveloperLogs_*` already exists in local storage.

## Current state schema

Current `sourcesPlusState_<projectId>` payloads use `schemaVersion: 4`.

```json
{
  "schemaVersion": 4,
  "groups": ["group-id"],
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

- `groups` is the top-level group order.
- `groupsById` is the full group map. Group `children` must be treated defensively as an array; legacy or imported data can omit it.
- `ungrouped` is the source order outside plugin folders.
- `sourceStateById` stores metadata needed to remap sources after NotebookLM DOM changes.
- `sourceStateById[sourceKey].addedAt` stores when the extension first recognized a source. It is optional for legacy sources and powers the built-in Recent quick view; missing values must not be backfilled as recent during migration.
- `nativeLabelTitle` marks sources or groups that came from NotebookLM native label import. Ordinary user folders with the same visible name must not be treated as native labels unless this field is present.
- `sourceViewDisplayKind` stores the last list/label view used in this notebook. Missing or invalid values are ignored so legacy state does not force a view switch.
- `tagsById`, `tagOrder`, and `sourceTagsById` are optional in legacy data and must be normalized on load.

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
```

Load paths normalize older schemas to the current runtime shape and mark `pendingStorageUpgrade` so a later safe save rewrites current schema data.

## Backup and history

- Primary saves write both `sourcesPlusState_<projectId>` and `sourcesPlusState_<projectId>__backup`.
- Background save logic chooses the preferred stored state from primary/backup by revision metadata and content quality.
- `sourcesPlusHistory_<projectId>` is bounded by `sourcesPlusPreferences.historyRetentionLimit` and used for version history and repair recovery.
- History entries can include `label?: string` and `manual?: boolean` for named restore points. Automatic trimming preserves manual restore points before older automatic snapshots; if manual entries alone exceed the selected limit, the oldest manual entries are trimmed.
- Page lifecycle recovery can write a session/local fallback snapshot, but normal primary writes should go through background `SAVE_STATE`.

## Privacy boundary

Persisted state intentionally contains source titles, folder names, tag labels, stable tokens, fingerprints, and organization metadata. Treat these as private NotebookLM organization data.

Diagnostics and developer logs must stay more restrictive:

- Do not record source titles, source body text, tag labels, group names, full import/export JSON, long DOM text, or raw private URLs.
- Prefer counts, booleans, reason codes, source keys, and hashes.
- If an `Error` is logged, store only name, message, and a short stack hash.

## Import/export boundary

Settings export/import can include organization metadata, source titles, group names, tag labels, and source identifiers. It must continue to enforce file/text size limits, count limits, tree depth limits, cycle checks, source remapping, and tag normalization before applying imported data.
