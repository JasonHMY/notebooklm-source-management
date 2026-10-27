# Live DOM check — notebook.google.com, 2026-10-27

Ego Lite (task space 5), signed in, UI lang en-AU, extension NOT installed (clean native DOM).
5 notebooks probed read-only (rows: 11, 17, 50, 9, 24). **All 5 turned out to be Google "Featured notebooks"** (read-only for the user: More buttons disabled, featured book source). See the owned-notebook section below; it supersedes the featured sample where they differ. No clicks except navigation. Source titles not recorded.

## Still matches (extension's primary or fallback selectors)
- `.source-panel` (section) — `[data-testid="source-panel"]` = 0 (fallback carries it)
- `.scroll-area-desktop` = 1 (hidden by styles.css); `.scroll-area`, `[data-testid="scroll-area"]`, `.sources-list-container` = 0
- rows `.single-source-container` (all rows rendered, 50 of 50, no virtualization seen); `[data-testid="source-item"]`, `.source-item`, treeitem = 0
- `.source-title` ok; `[data-testid="source-title"]` = 0
- row checkbox `mat-checkbox.mat-mdc-checkbox.select-checkbox` with input aria-label `Select <title>`
- `.source-item-more-button` ok
- Select-all: `mat-checkbox.select-checkbox-all-sources`, input aria-label "Select all sources"
- `.panel-header` = 2; Angular app (ng-version placeholder)

## Changed / new
- More button aria-label is now **"More"** (code + fixture assume "More options"): `DEPS.moreBtn[0]` misses, class fallback works; `DEPS.icon[1]` `:not([aria-label="More options"] mat-icon)` exclusion no longer excludes; content-source-actions.js:2062/2084 selectors no longer exclude by aria (class guard at :2053 still excludes).
- Row icon classes: `source-item-source-icon icon <type>-icon-color` for typed sources (youtube/pdf/image) but generic sources have `icon icon-color` (no `-icon-color` prefix match) → `DEPS.icon[0]` misses generic sources.
- **No label view anywhere**: `label_auto` icon absent in all 5 notebooks; no `.source-label-group`, `mat-expansion-panel`, `mat-accordion`. Panel header icons: side_nav, sort. New **"Sort sources"** button (icon `sort`).
- Rows carry new classes `source-sorting-enabled`, `single-source-container-magic-index-only`, `source-picker__move-in`, sometimes `inaccessible-source`; attribute `draggable="false"`; new custom element `<source-picker>` and `<nb-popover>`.
- `inaccessible-source` rows (and a locked "book" style source with `lock` icon + `source-title-lock-icon`) have **no checkbox** (16/17, 8/9 rows with checkbox).
- None of `source-picker`, `Sort sources`, `select-checkbox-all-sources`, `source-sorting-enabled`, `inaccessible-source`, aria "More" appear in tests/smoke/helpers/notebooklm-fixture.js; fixture still models label view + "More options".

## Follow-up probes (same day, after the audit)
- Count attributes: `aria-setsize`, `data-total-count`, `data-source-count`, `aria-rowcount`, `aria-posinset`, `data-virtualized`, `aria-busy` — 0 anywhere on the page (50-source notebook); no `cdk-virtual-scroll-viewport`. => delete preflight `getAuthoritativeInventoryTotal` gets null (code inference; delete not executed).
- Stable identity: none of the 30 STABLE_SOURCE_ATTRIBUTES (data-source-id … aria-labelledby, href) on any of 50 rows or their descendants. => production identity is fingerprint (title | checkbox aria-label "Select <title>" | icon).
- Main JS bundles still reference `LabsTailwindOrchestrationService.DeleteLabels` (label backend exists); "Sort sources" string not in the 3 initial bundles (lazy chunk).
- Duplicate titles in the 50-row notebook: 0.

## Not checked (would need clicking)
- Contents of the "Sort sources" menu (whether label grouping moved there, sort keys).
- Native More menu items (rename/delete wording), source detail view.
- Non-English UI.

## Owned notebooks ("Recent notebooks", 6 probed, rows 53/4/14/1/2/1)

- Same row/title/checkbox/more-button classes; More buttons enabled, aria-label "More", icon `more_vert`.
- All rows have a checkbox; no `inaccessible-source`; no featured source.
- No count attributes; none of the 30 stable-identity attributes on rows or descendants; no virtualization.
- **Google's own total:** `chat-panel-header .cover-subtitle-source-count` ("N sources") present in all 6 and equal to the row count (absent in some featured notebooks).
- **Auto-label button** (notebooks with 14 and 53 sources only): `.label-row .label-row-start span > button.source-item-more-button.label-auto-button`, aria-label "Auto-label your sources by topic", icon `layers`, no `aria-haspopup` (direct action). Sort button: `button.source-sort-button` (aria-haspopup="menu", icon `sort`). Select-all: `mat-checkbox.select-checkbox-all-sources` in `.header-title`.
- No label groups and no `label_auto` icon in any owned notebook.
- Header also has `Add sources` (`nb-button.add-source-button`), add-note button, `source-discovery-query-box`, and a dismissible `notes-onboarding-banner`.
- Code check: `isNativeLabelActionMenuTrigger` treats any `.label-auto-button` as a label-view entry point, and `SOURCE_VIEW_SWITCH_PATTERNS[label]` matches /topic/; `restorePersistedSourceViewDisplayKind` → `switchNativeSourceView('label')` → `findNativeLabelViewEntryPoint` would click the auto-label button when the saved display kind is label.

Sanitized skeleton of a featured notebook panel (titles replaced): scratchpad `audit/live-skeleton-2026-10-27.html`.
