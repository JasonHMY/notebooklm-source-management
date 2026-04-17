# Popup Plugin Toggle Design

## Summary

Add a real global enable/disable control to the extension popup so users can explicitly turn the NotebookLM in-page manager on or off.

This is not a cosmetic popup toggle. When the user disables the extension:

- the current NotebookLM page should immediately unload the in-page manager
- future automatic injection should stop
- existing saved folders, tags, ordering, and source state should remain intact

When the user enables the extension again, the popup should restore normal behavior and the current NotebookLM page should attempt to reattach the manager immediately when possible.

## Goals

- Give users an obvious top-level control in the popup to enable or disable the extension.
- Make "disabled" a real runtime state, not just a popup presentation state.
- Keep popup behavior easy to understand:
  - enabled: popup behaves as it does today, plus a visible global toggle
  - disabled: popup clearly says the extension is off and offers a direct way to re-enable it
- Preserve all previously saved NotebookLM manager data while disabled.

## Non-Goals

- Do not disable the Chrome extension globally via Chrome's own extension controls.
- Do not delete or reset saved state when disabling the extension.
- Do not build cross-tab synchronization for every open NotebookLM tab in this change.
- Do not redesign the popup into a multi-screen settings app.

## User Experience

### Popup layout

The popup adopts layout option A from the design review: a top-level control block at the top of the panel.

Structure:

1. Plugin status card
   - label: plugin status
   - state text: enabled or disabled
   - toggle control
   - one short sentence describing what the toggle does
2. Existing popup status section
   - current notebook/page status when enabled
   - disabled-state explanation when disabled
3. Primary CTA

### Enabled state

When the extension is enabled:

- the toggle is on
- the popup continues to use the current context-aware launcher logic
- the primary button keeps its current meaning:
  - `Open Source Manager`
  - `Refresh Current Notebook`
  - `Go To NotebookLM`
  - `Go To Open Notebook`

### Disabled state

When the extension is disabled:

- the toggle is off
- the title/body switch to disabled-specific copy
- the existing launcher state logic is bypassed
- the primary button becomes `Enable Plugin`
- the detail/note text explains that:
  - the current page manager is unloaded immediately when possible
  - future automatic injection is paused
  - saved groups and tags are preserved

### Toggle behavior

When the user turns the toggle off:

1. persist global `enabled = false`
2. if the active tab is a NotebookLM notebook or home page with the content script loaded, ask the content script to disable itself immediately
3. popup re-renders into disabled state

When the user turns the toggle on:

1. persist global `enabled = true`
2. if the active tab is a NotebookLM page, ask the content script to attempt re-enable immediately
3. popup returns to normal enabled-state rendering

## Functional Design

### Global source of truth

`background/index.js` becomes the single trusted source of the extension enabled state.

Persisted storage key:

- `extensionEnabled`

Default behavior:

- missing key means enabled
- this preserves behavior for existing users after upgrade

### Background responsibilities

The background script will:

- answer enabled-state queries
- persist enabled-state changes
- optionally forward enable/disable commands to the active NotebookLM tab involved in the popup interaction

New runtime messages handled by background:

- `GET_EXTENSION_ENABLED`
  - response: `{ success: true, enabled: boolean }`
- `SET_EXTENSION_ENABLED`
  - request: `{ type: 'SET_EXTENSION_ENABLED', enabled: boolean, tabId?: number }`
  - response: `{ success: true, enabled: boolean, forwarded?: boolean, forwardErrorCode?: string }`

Forwarded content-script messages:

- `DISABLE_MANAGER`
- `ENABLE_MANAGER`

Forwarding rules:

- only forward to the active tab provided by the popup
- only attempt forwarding if the tab is on `https://notebooklm.google.com/*`
- forwarding failure must not roll back the persisted global enabled state

Rationale:

- the user asked for direct control, not a fake popup-only state
- this keeps the implementation bounded to the current tab rather than expanding into all open NotebookLM tabs

### Popup responsibilities

The popup will query enabled state before computing page-context launcher UI.

Popup initialization order:

1. localize document
2. query active tab
3. query `GET_EXTENSION_ENABLED`
4. branch:
   - disabled: render disabled UI and stop
   - enabled: continue current page-context and manager-status flow

New popup behavior:

- the toggle always reflects the global enabled state
- changing the toggle calls `SET_EXTENSION_ENABLED`
- when disabled:
  - do not call `GET_MANAGER_STATUS`
  - do not show refresh-needed notebook states
  - do not use the current launcher CTA mapping
- when disabled, clicking the primary button behaves the same as turning the toggle on

### Content script responsibilities

The content script must treat disabled as a hard runtime gate.

New internal runtime flag:

- `isExtensionEnabled`

Startup behavior:

1. query background for `GET_EXTENSION_ENABLED`
2. if disabled:
   - set runtime flag false
   - skip automatic `init`
   - skip recovery and route-based reattachment
3. if enabled:
   - continue current boot behavior

New content-script message handling:

- `DISABLE_MANAGER`
  - set runtime flag false
  - call `teardown()`
  - set `managerStatusReason = 'extension_disabled'`
  - respond `{ success: true, disabled: true }`
- `ENABLE_MANAGER`
  - set runtime flag true
  - if current page is eligible, attempt `init()` or lifecycle sync
  - respond `{ success: true, enabled: true, attempted: boolean }`

### Status model changes

Add a new explicit manager status reason:

- `extension_disabled`

Behavior:

- `GET_MANAGER_STATUS` returns `{ ready: false, reason: 'extension_disabled' }` when disabled
- popup maps this to dedicated disabled copy if it ever sees it while enabled-state data is stale

This avoids conflating a deliberate disable with:

- `manager_not_ready`
- `source_panel_missing`
- `manager_unreachable`

## Data Preservation Rules

Disabling the extension must not clear:

- saved folder/group structures
- tags
- tag assignments
- source enabled/disabled state
- custom panel height
- backup snapshots

Only runtime attachment is suspended.

Re-enabling resumes normal use of previously saved state.

## Error Handling

### Storage write failure

If `SET_EXTENSION_ENABLED` cannot persist the new value:

- popup leaves the toggle in its previous state
- popup shows a detail error
- no enable/disable forwarding is attempted

### Forwarding failure to active tab

If background successfully persists enabled state but cannot forward `DISABLE_MANAGER` or `ENABLE_MANAGER` to the current tab:

- popup still reflects the new global state
- popup shows a detail message saying the current page may require refresh or reopening to fully apply

Rationale:

- the global preference is authoritative
- a single page messaging failure should not create state ambiguity

### Content script disable while already detached

If `DISABLE_MANAGER` arrives when the content script is already not attached:

- respond success
- just update the runtime flag and status reason

### Re-enable on unsupported page

If `ENABLE_MANAGER` arrives on a NotebookLM page that is not currently attachable:

- respond success with `attempted: false` or an equivalent signal
- leave normal route/lifecycle hooks available for later attachment

## UI Copy Changes

Add localized popup strings for:

- plugin status label
- enabled state label
- disabled state label
- disabled title
- disabled body
- enable plugin CTA
- optional detail text for forwarding failure
- disabled reason mapping for `extension_disabled`

Both English and Simplified Chinese must be updated. Existing locale tests should expand to cover the new keys.

## Testing Plan

### Background unit tests

Add tests for:

- default `extensionEnabled` fallback to `true`
- `GET_EXTENSION_ENABLED`
- `SET_EXTENSION_ENABLED` persistence
- forwarding disable message to a NotebookLM tab
- forwarding enable message to a NotebookLM tab
- persistence succeeds while forwarding fails

### Popup unit tests

Add tests for:

- disabled state renders without running notebook manager inspection
- primary button becomes `Enable Plugin` when disabled
- toggle change invokes `SET_EXTENSION_ENABLED`
- disabled state bypasses normal launcher-state rendering
- error detail renders on persistence failure

### Content unit tests

Add tests for:

- startup skips `init` when background reports disabled
- `DISABLE_MANAGER` triggers `teardown`
- `ENABLE_MANAGER` triggers reattempted initialization on eligible pages
- route change handlers short-circuit while disabled
- `GET_MANAGER_STATUS` returns `extension_disabled` when disabled

### Smoke test

Extend Playwright smoke coverage with this flow:

1. load unpacked extension into the NotebookLM fixture
2. verify manager is present
3. disable extension through the popup or extension bridge
4. verify `#sources-plus-root` disappears
5. re-enable extension
6. verify manager reappears

## Implementation Notes

- Keep the current popup launcher behavior intact when enabled.
- Avoid a large popup redesign; this change is a structural enhancement, not a full restyle.
- Keep the background message contract narrow so the feature can later expand to multi-tab synchronization without rewriting popup logic.

## Open Questions Resolved

- Toggle position: top-level control block
- Disabled CTA: `Enable Plugin`
- Disable semantics: real disable with immediate unload of the current page manager
- Scope of runtime sync: current relevant tab only

## Acceptance Criteria

- Users can clearly see whether the extension is enabled or disabled from the popup.
- Turning the toggle off disables future injection and unloads the current page manager when reachable.
- Turning the toggle on restores normal popup behavior and attempts current-page reattachment.
- No saved manager data is lost during disable/enable cycles.
- Automated unit and smoke coverage prove the new behavior.
