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
│   └── Global preferences, currently developerModeEnabled.
└── sourcesPlusDeveloperLogs_<projectId>
    └── Per-notebook bounded developer logs.
```

`<projectId>` is derived from the NotebookLM notebook URL. Notebook-scoped writes normally go through the background service worker, which validates the sender and key prefix before touching storage.

## Current state schema

Current `sourcesPlusState_<projectId>` payloads use `schemaVersion: 3`.

```json
{
  "schemaVersion": 3,
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
      "nativeLabelTitle": "optional native label title"
    }
  },
  "customHeight": null,
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
- `nativeLabelTitle` marks sources or groups that came from NotebookLM native label import. Ordinary user folders with the same visible name must not be treated as native labels unless this field is present.
- `tagsById`, `tagOrder`, and `sourceTagsById` are optional in legacy data and must be normalized on load.

## Migrations

```text
schemaVersion 1
└── Legacy state with enabledMap and no sourceStateById/tag fields.

schemaVersion 2
└── Adds sourceStateById but no tag fields.

schemaVersion 3
└── Adds tagsById, tagOrder, sourceTagsById, and current source identity metadata.
```

Load paths normalize older schemas to the current runtime shape and mark `pendingStorageUpgrade` so a later safe save rewrites current schema data.

## Backup and history

- Primary saves write both `sourcesPlusState_<projectId>` and `sourcesPlusState_<projectId>__backup`.
- Background save logic chooses the preferred stored state from primary/backup by revision metadata and content quality.
- `sourcesPlusHistory_<projectId>` is bounded and used for version history and repair recovery.
- Page lifecycle recovery can write a session/local fallback snapshot, but normal primary writes should go through background `SAVE_STATE`.

## Privacy boundary

Persisted state intentionally contains source titles, folder names, tag labels, stable tokens, fingerprints, and organization metadata. Treat these as private NotebookLM organization data.

Diagnostics and developer logs must stay more restrictive:

- Do not record source titles, source body text, tag labels, group names, full import/export JSON, long DOM text, or raw private URLs.
- Prefer counts, booleans, reason codes, source keys, and hashes.
- If an `Error` is logged, store only name, message, and a short stack hash.

## Import/export boundary

Settings export/import can include organization metadata, source titles, group names, tag labels, and source identifiers. It must continue to enforce file/text size limits, count limits, tree depth limits, cycle checks, source remapping, and tag normalization before applying imported data.
