# GeminiNotebook-Source-Management UI Guidelines

## 1. Purpose

This document is the UI source of truth for this extension.

It serves two roles:

1. Explain how the current UI is implemented.
2. Define the rules that all future UI changes must follow so the product does not become visually inconsistent.

When a new feature is added, its UI should match this document first and the existing code second. If the code and this document diverge, either:

1. Update the code to match this document, or
2. Intentionally revise this document and note the change in the PR.

Important: the CSS file currently contains some layered overrides and repeated selectors. The canonical values in this document reflect the final rendered intent, not the first occurrence in the stylesheet.

## 2. UI Architecture

### 2.1 Two UI surfaces

This extension has two separate UI surfaces:

- Content panel UI inside Gemini Notebook.
- Browser action popup UI used as a launcher/status page.

These two surfaces are intentionally different:

- The content panel is compact, utility-heavy, and embedded into Gemini Notebook.
- The popup is a small, branded launcher with a single primary action.

Do not mix the two styling systems casually.

### 2.2 Content panel implementation

The main manager UI is implemented by the content script and injected into the Gemini Notebook page.

Implementation flow:

1. `src/content/index.js` finds the Gemini Notebook source panel.
2. It creates `#sources-plus-root`.
3. It attaches an open Shadow DOM.
4. It injects one `<style>` tag using `NSM_CONTENT_STYLE_TEXT`.
5. It injects the initial shell using `NSM_CREATE_MANAGER_SHELL`.
6. It binds events.
7. It renders the list from extension state.

Relevant files:

- `src/content/index.js`
- `src/content/content-template.js`
- `src/content/content-panel-dom.js`
- `src/content/content-source-actions.js`
- `src/content/content-tags.js`
- `src/content/content-state-reconcile.js`
- `src/content/content-persistence.js`
- `src/content/content-modals.js`
- `src/content/content-render.js`
- `src/content/content-view-state.js`
- `src/content/content-tree-interactions.js`
- `src/content/content-source-sync.js`
- `src/content/content-style-text.js`

Important implementation characteristics:

- The content panel uses Shadow DOM to isolate styles from Gemini Notebook.
- DOM is built with the shared `el(...)` helper from `src/utils/index.js`.
- UI strings should come from `chrome.i18n` via `getMessage(...)`.
- Re-rendering is state-driven and uses fragment patching, not `innerHTML`.
- Event handling is largely delegated from container nodes.

### 2.3 Global overlay exception

Shadow DOM cannot style some Gemini Notebook-native Angular Material overlays, menus, or dialogs. Because of that, the extension also injects global overlay CSS into `document.head`.

This is handled through `NSM_GLOBAL_OVERLAY_STYLE_TEXT`.

Use this path only when a UI element lives outside the Shadow DOM tree, for example:

- Native Angular Material menu panels
- Native dialogs

If a new UI can be kept inside the Shadow DOM, keep it there.

Global native-menu/dialog styling is operation-scoped. `content-native-action-coordinator.js`
adds the `sources-plus-native-action-active` class and
`data-nsm-native-action-active="true"` attribute only while a manager-owned
details/rename/delete or batch-delete operation is active; every global Angular Material selector
must also require the operation marker. Success, failure, cancellation, timeout,
route change, and teardown all remove both markers. The manager's normal mounted
lifetime must not restyle unrelated Gemini Notebook menus or dialogs.

### 2.4 Popup implementation

The popup is a normal extension page, not part of the Shadow DOM system.

Relevant files:

- `src/popup/popup.html`
- `src/popup/index.js`
- `src/popup/styles.css`

Popup characteristics:

- Fixed-width launcher/status layout
- One primary CTA
- Enable/disable switch for the extension runtime state
- Source view segmented control when a notebook tab in Gemini Notebook is active
- Status copy driven by current tab context
- Tokenized light and dark themes using `prefers-color-scheme`

## 3. Naming and Structure Rules

### 3.1 Class namespace

Use these namespaces consistently:

- `sp-` for content-panel UI classes
- `popup-` for popup UI classes

Do not introduce unscoped class names for new extension UI unless there is a very good reason.

### 3.2 DOM creation rules

All new content-panel UI should be created with the shared `el(...)` helper.

Reasons:

- Keeps DOM creation consistent
- Blocks insecure inline event attributes
- Avoids unsafe HTML injection patterns

Do not add raw `innerHTML` for new interactive UI.

### 3.3 Localization rules

All user-facing copy should use `chrome.i18n` keys.

Do not hardcode new English or Chinese strings in UI markup unless it is a true emergency fallback.

## 4. Design Principles

The current visual language is a hybrid of:

- Compact utility UI
- Apple-like glass and motion cues
- Low-chroma neutral surfaces
- Accent-driven state signaling

The panel should feel:

- Calm, not loud
- Dense, not cramped
- Tactile, not gimmicky
- Layered, not flat

Future additions should preserve these traits.

## 5. Core Design Tokens

### 5.1 Color tokens

Content panel tokens live on `:host` in `src/content/content-style-text.js`.

Light mode:

- `--sp-bg-primary: transparent`
- `--sp-bg-secondary: rgba(0,0,0,0.03)`
- `--sp-bg-hover: rgba(0,0,0,0.04)`
- `--sp-bg-button: #fff`
- `--sp-bg-button-hover: #f5f5f7`
- `--sp-bg-button-active: #ebebeb`
- `--sp-panel-bg: #f6f7f9`
- `--sp-text-primary: #1A1A1C`
- `--sp-text-secondary: #6E6E73`
- `--sp-accent-fill: #007aff`
- `--sp-accent-text: #0066cc`
- `--sp-danger-fill: #ff3b30`
- `--sp-danger-text: #c62828`
- `--sp-accent: var(--sp-accent-fill)`
- `--sp-accent-danger: var(--sp-danger-fill)`
- `--sp-accent-success: #34c759`

Dark mode overrides:

- `--sp-bg-secondary: rgba(255,255,255,0.05)`
- `--sp-bg-hover: rgba(255,255,255,0.08)`
- `--sp-bg-button: #1c1c1e`
- `--sp-bg-button-hover: #2c2c2e`
- `--sp-bg-button-active: #3a3a3c`
- `--sp-panel-bg: #272c33`
- `--sp-text-primary: #f5f5f7`
- `--sp-text-secondary: #98989d`
- `--sp-accent-fill: #0a84ff`
- `--sp-accent-text: #64a8ff`
- `--sp-danger-fill: #ff453a`
- `--sp-danger-text: #ff6961`
- `--sp-accent: var(--sp-accent-fill)`
- `--sp-accent-danger: var(--sp-danger-fill)`
- `--sp-accent-success: #30d158`

Semantic usage:

- Accent blue: interactive focus, selected state, tag-active state, reorder hints.
- Danger red: destructive actions, failed imports, delete affordances.
- Success green: enabled group switch.
- Secondary neutrals: passive chrome, tags, badges, helper text.
- `*-text` tokens: foreground text/icons on panel or modal surfaces; these values
  are contrast-tested separately from the brighter fill colors.
- `*-fill` tokens: selected fills, switches, borders, drag indicators, and
  destructive button backgrounds. Do not use a fill token as ordinary text.

Rules:

- New UI must use existing semantic tokens first.
- If a new color is needed, add a token before using a literal value.
- Avoid one-off colors in component rules.
- Ordinary text must meet WCAG contrast ratio `4.5:1`; large text and non-text
  controls/indicators must meet `3:1`. Keep the pure contrast-ratio regression
  checks in `tests/content/content-render.test.js` aligned with token changes.

### 5.2 Border tokens

Current shared borders:

- `--sp-border-light: rgba(...)`
- `--sp-border-medium: rgba(...)`
- `--sp-border-checkbox: rgba(...)`

Rules:

- Default container or quiet control border: `--sp-border-light`
- Hover-strength border or stronger separation: `--sp-border-medium`
- Custom checkbox outline: `--sp-border-checkbox`

### 5.3 Shadow tokens

Current shadow tokens:

- `--sp-shadow-button`
- `--sp-shadow-toast`
- `--sp-shadow-hover-item`
- `--sp-shadow-switch-thumb`
- `--sp-glass-shadow`

Usage:

- Buttons: soft ambient shadow
- Hovered rows: lift shadow
- Toasts and modals: stronger elevation
- Glass menus/dialogs: glass shadow token

Rules:

- Reuse these tokens for elevation first.
- Do not invent a new shadow just because one component feels special.
- If a new elevation level is necessary, define it as a token and document the intended layer.

### 5.4 Radius scale

The current UI consistently uses a small set of radius values.

Canonical radius scale:

- `3px`: resizer bar
- `4px`: source icon images copied from Gemini Notebook or extension assets
- `6px`: checkbox, tree border tail
- `8px`: source rows, small utility buttons, popup segmented-control container
- `10px`: option rows, tag inputs, tag row buttons
- `12px`: standard button, icon action button, badges, toasts, popup cards, popup CTA
- `14px`: banners, action menus
- `16px`: modal shell, batch action bar
- `18px`: toggle track
- `999px`: pills

Rules:

- Do not use arbitrary radii like `7px`, `9px`, `13px`, `15px`.
- Choose the nearest existing radius bucket.

### 5.5 Typography scale

Content panel typography:

- `11px`: badges, pills, section labels
- `12px`: banner labels, menu labels, small helper copy
- `13px`: default control text, titles, inputs, button labels
- `14px`: folder option text, empty states, toast text
- `16px`: modal title

Popup typography:

- `12px`: eyebrow, popup labels, segmented source-view buttons, helper copy, note/detail
- `13px`: body, toggle state, primary CTA
- `18px`: title

Rules:

- Default text in the content panel should remain `13px`.
- Small metadata should stay in the `11px` to `12px` band.
- Only use `16px+` for true hierarchy shifts such as modal titles or popup headings.

### 5.6 Icon scale

Current icon sizes:

- `16px`: row icons, action buttons, tag row buttons, menu icons
- `18px`: toolbar icon buttons
- `20px`: caret, folder option icon

Rules:

- `16px` is the default for list-level action UI.
- `18px` is for toolbar-level icon buttons.
- `20px` is reserved for navigational or modal list items.

### 5.7 Motion system

The current content panel and popup use a shared three-curve motion system.

Easing tokens:

- `--sp-ease-standard` / `--popup-ease-standard`: `cubic-bezier(0.2, 0.8, 0.2, 1)`
- `--sp-ease-emphasized` / `--popup-ease-emphasized`: `cubic-bezier(0.2, 0.9, 0.25, 1)`
- `--sp-ease-press` / `--popup-ease-press`: `cubic-bezier(0.25, 1, 0.5, 1)`

Use `standard` for:

- Hover transitions
- Color and border changes
- Small opacity changes

Use `emphasized` for:

- Collapse/expand
- Reveal/hide
- Toast motion
- Modal motion
- List entry animation

Use `press` for:

- Button press/release scale feedback
- Checkbox checkmark drawing
- Small tactile icon feedback

Current duration tokens:

- `120ms`: quick press and icon feedback
- `180ms`: base hover, border, background, and opacity feedback
- `240ms`: medium reveal, list entry, and checkbox feedback
- `320ms`: slower modal, shell, and route-level transitions

Rules:

- Use the motion tokens instead of raw durations for new UI.
- Use `standard` for most state changes, `emphasized` for reveal/entry, and `press` for tactile scale.
- Avoid raw `ease-in-out` or ad hoc cubic curves.
- `linear` is allowed for true continuous indicators such as spinners and progress loops.

### 5.8 Z-index layers

Current practical layer system:

- `5`: sticky batch bar
- `20`: sticky controls
- `9999`: toast
- `10000`: overlay backdrop
- `10001`: modal
- `10002`: source action menu layer
- `10003`: elevated toast (`.sp-toast-elevated`) — a toast lifted above an open modal + its frosted backdrop so it stays readable (e.g. a settings failure toast). Opt in per-toast via the `{ elevated: true }` showToast option; normal toasts stay at `9999`.

Rules:

- New in-panel floating UI must fit this stack.
- Do not jump to `999999`.
- If a new overlay is needed, place it intentionally relative to backdrop, modal, and action menus.

## 6. Content Panel Shell Specification

The content panel root is `.sp-container`.

Current traits:

- Vertical flex layout
- Embedded panel surface
- `max-height: calc(100vh - 220px)`
- `min-height: 150px`
- system font stack
- background: `--sp-panel-bg`

Focus/highlight state:

- `.sp-container.sp-focus-ring`
- Uses accent-colored dual shadow
- Slight upward translate

Rules:

- New shell-level emphasis should use `sp-focus-ring` style language, not a new border treatment.
- Do not add busy backgrounds or gradients inside the content panel shell.

## 7. Sticky Toolbar and Search

### 7.1 Toolbar layout

`.sp-controls` is the sticky toolbar.

Characteristics:

- `position: sticky`
- top aligned
- two-column grid: wrapping toolbar actions plus the compact search trigger; expanded search occupies its own full-width row
- bottom border for separation
- no heavy visual chrome

Toolbar actions live in `.sp-toolbar-actions`.

Rules:

- Top-level actions remain compact. The grid gives `.sp-toolbar-actions` a shrinkable column whose buttons wrap without clipping or hiding the action set.
- New top-level actions must be justified as "frequently used, global, and not row-scoped".
- Do not overload the toolbar with low-frequency actions.
- Undo and Redo are the canonical history actions. Their icon buttons expose localized names and remain disabled until the corresponding transactional history stack can be applied.

### 7.2 Search behavior

The search UI uses an expandable container:

- Default compact icon state
- Expanded on interaction
- Keeps the toolbar visible and operable while the input expands on a separate row
- Uses `focus-within` ring on the container

Search implementation details:

- Container: `.sp-search-container`
- Input: `#sp-search`
- Icon button: `#sp-search-btn`
- Search updates coalesce within an `80ms` interaction budget; scheduled work uses a short `16ms` timer
- Enter triggers immediate search
- The result summary reserves enough trailing space for the normal panel width. When ellipsized, both the status and underlying search input expose the complete localized summary through `title`; the count only switches to the compact `74px` width at manager widths of `320px` or less.

Rules:

- Any future inline filter should visually integrate with this expandable-search model.
- Do not add a second unrelated search field elsewhere in the panel.

### 7.3 Quick view rail

The compact quick view rail lives directly below the toolbar as `.sp-quick-view-rail`.

Current built-in views:

- All
- Ungrouped
- Disabled
- Tag
- Recent
- Issues

Rules:

- Quick view pills use existing `--sp-*` tokens, small type, and accent active state.
- The rail keeps horizontal and vertical safe inset, plus scroll padding, so active/focus outlines are not clipped by the source panel edge or toolbar boundary.
- Quick view buttons use a reset native appearance and fixed inline-flex capsule height; do not rely on default browser button rendering for this row.
- Users may hide any or all quick view buttons through Settings; this only changes rail visibility, not the command palette actions or custom shortcuts.
- When every quick view button is hidden, the rail itself must be `display: none` so it does not leave an empty strip between the toolbar and source list.
- Quick view state is session-only except for source metadata required to support it, such as `sourceStateById[sourceKey].addedAt`.
- Choosing a quick view must not clear the search query; it may clear other view-level state such as folder isolation or tag quick filter to keep the result set understandable.
- Do not turn this rail into user-defined saved views until a separate design handles naming, persistence, and conflict behavior.

The source list keeps a small bottom safe area so the final row can scroll above the resizer and Gemini Notebook's native add/search controls instead of being clipped in dense All view.

## 8. Buttons

### 8.1 Primary panel button: `.sp-button`

Canonical style:

- Border radius: `12px`
- Padding: `6px 12px`
- Background: `--sp-bg-button`
- Border: `1px solid --sp-border-light`
- Font size: `13px`
- Font weight: `500`
- Shadow: `--sp-shadow-button`

Feedback:

- Hover: brighter surface + stronger border
- Active: `scale(0.98)`
- Hover feedback should not use decorative sweep or glare pseudo-elements; keep the state change to surface, border, and subtle scale.

Use for:

- Toolbar buttons
- Banner CTA
- Confirm/save actions
- Batch action buttons after variant styling

Rules:

- Default action buttons should extend `.sp-button`.
- If a button needs a stronger semantic state, restyle color tokens on top of `.sp-button`.
- Do not build new button styles from scratch unless the role is fundamentally different.

### 8.2 Icon button: `.sp-icon-button`

Canonical style:

- Padding: `4px`
- Radius: `8px`
- No border
- Default secondary text color
- Hover: hover-surface background + `scale(1.06)`
- Active: `scale(0.95)`

Use for:

- Search toggle
- Compact chrome actions

Rules:

- Icon-only controls must have `title` and `aria-label`.
- Do not use `.sp-icon-button` for destructive actions without an explicit semantic override.

### 8.3 Row action button family

Classes:

- `.sp-source-actions-button`
- `.sp-tree-order-button`
- `.sp-add-subgroup-button`
- `.sp-isolate-button`
- `.sp-edit-button`
- `.sp-delete-button`

Shared traits:

- 24 x 24
- Radius `12px`
- Icon size `16px`
- No border
- Neutral by default

Feedback:

- Hover: hover-surface background
- Hover scale: `1.06`
- Active scale: `0.95`

Special behavior:

- Source action button defaults to partial opacity and becomes fully visible on row hover.
- Group secondary actions stay hidden until hover and reveal with opacity + translate + scale.
- Precise-order group buttons live in `.sp-tree-order-controls`, reuse this 24×24 family, and reveal as one compact cluster on hover or `:focus-within`.
- Delete hover uses red tint and danger color.
- Isolate active state uses accent tint.

Rules:

- Row actions should not always be fully visible unless the action is critical.
- Reveal-on-hover is the default for row-scope secondary actions.

### 8.4 Popup button

Popup uses a separate CTA style:

- Full width
- Min height `42px`
- Radius `12px`
- Solid accent fill from `--popup-accent`
- Action shadow from `--popup-shadow-action`
- Hover: accent hover color + `scale(1.02)`
- Active: accent active color + `scale(0.98)`
- Disabled: wait cursor, reduced opacity, no transform

Rules:

- Popup CTA is the only strong branded button style in the project.
- Do not reuse popup button styling inside the content panel.

### Native selection progress

- `#sp-native-selection-sync-section` reuses `.sp-manager-save-status-region` and `.sp-save-status` to display actual native checkbox confirmations.
- Show it only when a multi-source update remains pending after 150ms; do not flash normal completion messages for immediate operations.
- The live region reports confirmed/total counts, and `#sources-list` exposes `aria-busy` until all requested native states settle. Completion clears the progress; failures use the existing actionable native-sync failure banner.
- Lifecycle teardown cancels the remaining plugin queue and resolves its waiting operations. This progress is separate from persistent save status.

### Source matching repair

- Ambiguous saved sources show their saved folder path and current live targets with localized native-list positions. Defaults remain unselected; never present an arbitrary match as a recommendation.
- Use natural ambiguous/unmatched explanations, not internal resolver reason codes. A changed list or incomplete mapping must leave the original organization and show actionable feedback.
- Matching authorization is scoped to the current connected native rows; reopening after another ambiguous DOM replacement requires a new explicit choice.

### Native deletion confirmation

- Single-source deletion and batch deletion reuse the same alertdialog pattern and focus Cancel initially.
- Single-source confirmation shows the complete source title and irreversible-delete copy. Cancel, Escape, backdrop dismissal, and manager teardown all decline the operation before native controls are clicked.
- After confirmation, the original native identity/inventory checks remain mandatory; a batch uses its one batch confirmation, not an extra dialog per item.

## 9. Selection Controls

### 9.1 Source checkbox: `.sp-checkbox`

Canonical style:

- `18 x 18`
- Radius `6px`
- Thick border
- Accent fill on checked
- Custom-drawn checkmark with pseudo-element

Feedback:

- Hover: accent border + `scale(1.05)`
- The checked checkmark is drawn statically via `.sp-checkbox:checked::before` (width/height/opacity) — there is no animated draw-in, so programmatic sync and batch selection never flicker or replay a pop. (An older `.is-animating` organic draw + spring keyframes existed but were never wired up by any code path and have been removed; reintroduce only by adding the class on direct user toggle and clearing it on `animationend`.)

Rules:

- New checkbox-like controls should reuse `.sp-checkbox` unless there is a very strong reason not to.
- Avoid native browser checkbox visuals for in-panel controls.

### 9.2 Group switch

Classes:

- `.sp-toggle-switch`
- `.sp-group-toggle-checkbox`
- `.sp-toggle-slider`

Canonical style:

- Track: `36 x 20`
- Knob: `16 x 16`
- Checked state: success green
- Slight scale reduction on overall switch for density

Rules:

- Use the switch only for persistent enabled/disabled state.
- Use checkboxes for multi-select or item inclusion.

## 10. Source Row and Group Row Specification

### 10.1 Source row

Class: `.source-item`

Canonical layout:

- CSS grid row
- Columns: `18px 24px minmax(0, 1fr) auto`
- Padding left `12px`
- Column gap `8px`
- Vertical rhythm with `2px` gaps between rows
- Final radius `8px`
- Border kept transparent until needed

Structure:

1. Icon
2. Source action trigger or stable placeholder
3. Title, loading status, and tags
4. Right-side checkbox or batch checkbox

Feedback:

- Hover: `scale(1.01)`, background hover tint, hover shadow, elevated z-index
- Active: `scale(0.995)`
- Hover should feel lifted, not shoved sideways

State variants:

- `gated`: reduced opacity + grayscale
- `failed-source`: danger color treatment, disabled affordance
- `loading-source`: wait cursor, spinner, pulsing title, hidden checkbox
- `selected-for-batch`: tinted selection + dashed accent border
- `dragging`: active pointer-session marker (cursor: grabbing). In reflow mode the origin also folds out of the layout while a fixed Shadow DOM ghost follows the pointer. See 13.4.

Rules:

- New row-level visuals must respect the same density and feedback language.
- Do not add permanent heavy borders around normal rows.
- The title area should remain the primary click target.
- Treat the native three-dot action button as a per-row capability signal. If it is absent, omit native Details/Rename/Delete while keeping plugin-local custom-tag, folder, and precise-order actions available.

### 10.2 Group row

Classes:

- `.group-container`
- `.group-header`
- `.group-children`

Canonical traits:

- Same motion language as source rows
- Heavier emphasis through weight and hierarchy, not loud color
- Indentation driven by inline `--sp-tree-indent`: `min(level, 8) * 12px`
- Tree line via left border on `.group-children`

Group header contents:

1. Caret
2. Enable switch
3. Group title
4. Count badge
5. Precise-order hover/focus cluster (up/down/in/out)
6. Secondary hover actions

Feedback:

- Same lift behavior as row hover
- Caret rotates on collapse
- Child tree line turns accent on group hover

Rules:

- Group UI must feel structurally related to source rows, not like a separate product.
- Future nested controls must not break indentation rhythm or tree-line clarity.
- Persisted/imported trees remain compatible through 50 levels. Visual
  indentation stops growing after level 8 so deep rows retain usable width;
  the full ancestor breadcrumb remains in the group container and named-control
  ARIA labels, and `data-tree-depth` retains the logical level.
- At 240 or more logical visible sources, source rows are windowed with 20 rows
  of overscan above and below the viewport. Aggregate presentation-only spacers
  preserve scroll geometry; group headers and the canonical 50-level tree stay
  intact. When the logical projection is unchanged, actual row/spacer rectangles
  anchor the window so folded rows and group headers cannot displace it into a blank area.
- Search counts, visible/hidden batch selection, keyboard ordering, and drag
  placement must use the full logical projection, never the current DOM row
  count. Focused rows, an open source-action row, and active drag source/target
  rows remain materialized until their interaction ends.
- Windowed rows expose their logical position and complete set size through
  `aria-posinset` and `aria-setsize`. Reconciliation must reuse stable source
  keys and scrolling may schedule at most one render per animation frame.
- The four precise-order buttons are omitted in batch mode. In filtered/search/isolation views they still operate on the canonical full tree, and their status reports canonical position rather than the visible subset.
- At manager container widths of 320px or less, the group header wraps while its title keeps at least `6ch` of inline space and may use the existing two-line allowance. The count badge, precise-order cluster, add-subfolder, isolate, edit, and delete actions remain present and keyboard reachable; they may flow onto another line instead of collapsing the title. This breakpoint follows the manager container, not the browser viewport, so it also covers side panels under 200%/400% zoom.
- New folders and subfolders enter inline naming immediately. A non-empty name commits one save, while Escape or an empty name cancels the temporary folder without creating an undo step. A rows patch must capture and restore the pending draft/editor, and persistence must omit the temporary folder and its parent/root edge until the name is confirmed. While naming, render must force the pending folder and ancestor path through search/tag/Quick View/isolation filters and virtual collapse; confirmation clears those view constraints and expands any stored-collapsed ancestors so the committed folder and focus target remain visible, while cancellation preserves the user's prior view.
- Group containers are `listitem`s and `.group-children` is the controlled nested `list`; collapse state must update both visual rotation and the accessibility attributes documented in §16.

### 10.3 Drag and drop feedback

Source and group rows have an always-visible, focusable six-dot `.sp-drag-handle`. Row-level summary:

- Pointer movement beyond 3px starts dragging from the handle; source and folder rows themselves are not native draggable elements. Loading/failed source handles and batch-mode folder handles are disabled.
- In the default reflow mode, the origin folds out of the list and a slot follows the pointer as nearby rows spring toward their target positions. A Shadow DOM row-clone ghost follows the pointer at full row width and `scale(1.025)`; classic mode retains the blue insertion line.
- The drop-target group shows an accent header (`.drag-into`); an invalid drop shows a red outline on the slot's top item or the group header.

**§13.4 is the single source of truth** for the full drag interaction — every class, ghost stacking, drop-landing motion, cancel/unfold timing, reduced-motion behavior, and the do-not-reintroduce rules. Keep drag details there, not duplicated here.

## 11. Titles, Tags, Badges, and Metadata

### 11.1 Title blocks

Classes:

- `.title-container`
- `.source-title-text`
- `.group-title`

Canonical behavior:

- Default text size `13px`
- Compact letter spacing that matches the current row density
- Flexible wrapping with `overflow-wrap: anywhere` and `word-break: break-word`
- Long URL or importing-source titles may occupy more than two lines to preserve the real source identity
- Keep metadata below or beside the title, not mixed into the same line

Rules:

- New source metadata should sit below the main title if it can wrap.
- Do not reintroduce layouts that force long source titles into one-character columns.
- If a future design clamps titles again, it must preserve a reliable way to inspect the full title.

### 11.2 Tag pills

Class: `.sp-tag-pill`

Canonical style:

- Pill radius
- Small secondary text
- Quiet neutral background
- Accent-tinted active state

Feedback:

- Hover: slightly stronger surface and text
- Active filter: accent tint + accent text

Rules:

- Tags should remain visually lightweight.
- Avoid using full-solid accent fills for idle tags.
- Interactive tag pills are buttons and expose `aria-pressed`; custom tag colors may tint the border/background, but foreground text must remain readable in both themes.

### 11.3 Badges

Class: `.badge`

Use for:

- Group counts
- Small numeric summaries

Rules:

- Keep badges compact and quiet.
- Badges are metadata, not actions.

### 11.4 Tag color editor

Classes:

- `.sp-tag-color-group`
- `.sp-tag-color-presets`
- `.sp-tag-color-swatch`
- `.sp-tag-color-trigger`
- `.sp-tag-color-hex`

Canonical style:

- Lives inside the tag modal/editor flow, not as a standalone panel control
- Uses the same compact density as inputs and list rows
- Preset swatches are circular, low-noise, and rely on border/ring state instead of large motion
- Custom color trigger reuses `.sp-button`
- Hex input reuses `.sp-tag-input`
- The native color input is a programmatic picker target and stays out of the Tab order; the visible trigger carries the accessible name.

Feedback:

- Swatch hover uses the same shared panel easing as other controls
- Active swatch uses the standard accent focus ring language
- Text input focus uses the same soft accent focus ring as other modal inputs

Rules:

- New tag-color affordances should extend this editor, not introduce a second color-picker pattern
- If color presets change, keep the interaction model the same: presets, custom trigger, and editable hex field
- Do not use loud animations or independent color-picker chrome inside the modal

## 12. Menus, Overlays, and Modals

### 12.1 Source action menu

Classes:

- `.sp-source-actions-layer`
- `.sp-source-actions-menu`
- `.sp-source-actions-menu-item`

Canonical style:

- Glass background
- Blur and saturation
- Radius `14px`
- Menu item radius `10px`
- Compact item padding

Feedback:

- Hover: menu row tint + slight `scale(1.02)` lift (keyboard focus, not hover, shifts the row `translateX(2px)`)
- Icons brighten with hover

Rules:

- Small contextual menus should follow this glass popover pattern.
- Do not create solid opaque dropdowns for content-panel context menus.
- Source precise ordering is a nested menu with up/down/in/out actions. Each child uses native `disabled` plus `aria-disabled`, and availability comes only from the Tree Placement directional resolver.

### 12.2 Modal system

Classes:

- `.sp-overlay-backdrop`
- `.sp-folder-modal`
- `.sp-folder-modal-header`
- `.sp-folder-modal-content`
- `.sp-folder-modal-footer`

Canonical style:

- Centered fixed modal
- Width `320px`
- Max height `80vh`
- Radius `16px`
- Frosted glass effect
- Dark-mode adjusted background and border
- Same system font stack as `.sp-container`; modal nodes mount outside the container and must not inherit Gemini Notebook page typography.

Motion:

- Backdrop fades in
- Modal scales and settles in from slightly above
- Exit reverses with slight upward drift

Rules:

- New panel-owned modal dialogs should reuse this shell.
- Footer actions should be right-aligned.
- Backdrop click may dismiss only when safe.
- Destructive batch confirmation uses the same shell with `role="alertdialog"`, a bounded source preview, an irreversible-action warning, Cancel as initial focus, and an explicit final action.
- The Move modal keeps folder selection and "create folder and move" in one flow; creating the destination and moving the current source selection must produce one saved history step.

Welcome onboarding:

- `.sp-welcome-modal` is a first-run modal built on the same shell.
- It uses existing `--sp-*` color, border, shadow, radius, and motion tokens so light and dark mode stay aligned with the panel.
- The top-right close button, primary action, backdrop click, and Escape key should all dismiss the modal and mark the current onboarding version as seen.
- The feedback button should reuse the existing Chrome Web Store feedback message path instead of adding another feedback destination.

What's New:

- `.sp-whats-new-modal` reuses the welcome modal layout and feature-row density.
- It should appear only for intentionally enabled update-introduction versions, not for every release.
- Developer preview entry points may open it without marking the current update version as seen.

Settings preferences:

- Lightweight preferences such as language, history retention, command palette entry, quick view button management, appearance toggles, and the developer-mode toggle should use `.sp-settings-preference-row` (left "title + helper", right control). Do not place controls inside `.sp-settings-section-header` — the header carries only the section title.
- Persistent on/off settings use `.sp-toggle-switch` (input gets `sp-group-toggle-checkbox` + the settings-specific class, wrapped in `<label class="sp-toggle-switch">` with a `.sp-toggle-slider`), not native checkboxes — consistent with §9.2. A switch inside a preference row is right-aligned via `.sp-settings-preference-row > .sp-toggle-switch { justify-self: end }`.
- Group long button clusters into titled `.sp-settings-subsection`s (e.g. the developer section splits Logs and Test tools), matching the backup section's export/import/history grouping.
- Keep preference copy short and functional; do not add explanatory cards inside settings sections.
- Export, copy, language, history, Import Backup, and import-file feedback shown
  while Settings is open belongs in modal-owned `role="status"`/`aria-live`
  regions (`.sp-settings-action-status`, `.sp-history-action-status`,
  `.sp-import-backup-status`) rather than a toast hidden behind the frosted
  backdrop. Use polite live updates for success and assertive updates for errors.
- Retryable error status remains visible until the operation succeeds or the user
  closes the modal. If a settings action requires rebuilding the modal, capture
  and restore the focused control key, expanded sections, and content `scrollTop`.

Command palette:

- `.sp-command-palette-modal` uses the same modal shell and focus trap.
- The search input is a standard `role="combobox"` with `aria-expanded`,
  `aria-controls`, `aria-activedescendant`, and `aria-autocomplete="list"`.
  Its controlled container is `role="listbox"` and contains only pure
  `role="option"` command rows.
- It is opened from the Settings preferences section. A single "Edit shortcut"
  button sits outside the listbox and operates on the active option; shortcut
  recording opens a separate small modal dialog rather than placing an editable
  control inside an option.
- Pointer movement updates only the previously active and newly active options,
  including `aria-selected`; it must not rebuild the whole result list. Closing
  shortcut recording restores focus to the originating shortcut button, or the
  combobox when that button is no longer available.
- No command ships with a default shortcut. Users may assign their own modifier-based shortcuts, and those shortcuts are stored in global preferences.
- Repeating a user-defined shortcut should reverse reversible command state where possible: collapse search, clear an active quick view, or close the corresponding modal.
- Commands should bridge to existing manager actions instead of duplicating business logic.
- Batch commands must remain disabled until batch mode has selected sources.

### 12.3 Option lists inside modals

Classes:

- `.sp-folder-option`
- `.sp-tag-option`
- `.sp-tag-row`

Canonical style:

- Radius `10px`
- Dense rows
- Clear icon/title separation
- Hover scale slightly up (`scale(1.01`–`1.02)`) for a gentle lift

Rules:

- Use list-row interaction language, not card-grid language, for modal choice lists.
- The tag-filter modal adds a compact search input, polite result count, distinct no-match state, and `aria-pressed` on the active option.

## 13. Temporary and Informational Surfaces

### 13.1 View state banners

Class: `.sp-view-banner`

Used for:

- Active isolation mode (visual filter only; the banner explicitly says answer sources remain unchanged)
- Active tag filter
- Active native-label view (`.sp-native-label-view-banner` modifier, with its own copy + CTA: `ui_native_label_view_active` / `ui_import_native_labels`)

Canonical style:

- Quiet contextual surface
- Border + gentle background
- Compact CTA on the right

Rules:

- View-state banners are for temporary mode context only.
- Do not use them for permanent settings.

### 13.2 Toast

Class: `.sp-toast`

Canonical behavior:

- Bottom center
- Blurred dark or light surface depending on theme
- Entrance from below with opacity + blur cleanup

Rules:

- Use toast for short confirmation only.
- Do not use toast for workflows that require decision-making.
- A toast shown while a modal with a frosted backdrop is open is obscured by the backdrop blur (toast `z=9999` < backdrop `z=10000`). In that context, suppress low-value success toasts and lift important ones above the modal with `.sp-toast-elevated` (`z=10003`) via the `{ elevated: true }` showToast option. The settings modal applies this: success confirmations are suppressed while it is open, and failures are shown elevated (see §5.8).

Actionable save/recovery feedback uses `.sp-manager-save-status-region` and `.sp-save-status`, not a toast. The manager and Settings render from the same status model, but idle, saving, and saved remain visually silent. Failed/stale states and recovery availability stay visible until resolved, with the relevant action rendered next to the message.

### 13.3 Empty states

Class: `.sp-empty-state`

Canonical style:

- Dashed border
- Centered text
- Subtle neutral background
- Slight scale-up when used as a drop target

Rules:

- Empty states should be quiet and actionable.
- Prefer one clear message over illustration-heavy placeholders.
- Distinguish a notebook with no native sources from search, filter, or isolated-folder no-results states.
- Search no-results offers Clear search; filtered no-results offers Clear filters; isolated-folder no-results offers Show all. Each action clears only the state named by its copy; folder isolation is a visual filter, so entering or leaving it never changes native answer-source checkboxes.
- A true empty notebook points the user to add sources in Gemini Notebook; it must not imply that the extension can create a native source.

### 13.4 Drag interaction (pointer sorting)

`dragMode` has two stored values: `reflow` (default when the field is absent) and `classic`. An explicit saved choice is preserved; invalid values fall back to `classic`. Both modes use the same six-dot `.sp-drag-handle` and Pointer Events. `classic` keeps the blue `.drag-over-top` / `.drag-over-bottom` insertion line and its original placement rule: loose sources cannot be positioned between root folders and instead enter the bottom Ungrouped bin. In `reflow`, the opened physical gap is the insertion indicator and root sources may sit between folders. The Settings → Appearance toggle controls the mode; switching to `classic` checkpoints and sweeps existing positioned root sources into Ungrouped after verified preference loading. Failed or unverified preference loading must not trigger a sweep. Preference LOAD/SAVE responses use monotonic request ordering, and failed mode changes restore the confirmed value.

Interaction and accessibility:

- The source-row and folder-header handle is a focusable button with a visible six-dot icon, an item-specific accessible label, a title, and keyboard instructions through `aria-describedby`. The handle stays visible at narrow panel widths. Source handles are disabled while loading or failed; folder handles are disabled in batch mode. Other row controls remain usable.
- A primary pointer press on an enabled handle arms a session. Movement beyond 3px starts the drag; the stable `#sources-list` container captures the pointer so row replacement and windowing do not interrupt it. Production does not bind native `dragstart` / `dragover` / `drop` listeners to the rows.
- The current source row or folder header is cloned into `.sp-drag-pointer-ghost` inside the Shadow DOM. The fixed outer ghost follows pointer Y directly; its layer scales to `1.025` and uses the existing row shadow. A multi-source selection shows up to three layers and a badge with the full count. The ghost is inert, `aria-hidden`, and `pointer-events: none`; cloned IDs and source/group datasets are stripped.
- Up/Down on a focused handle moves one position; Home/End moves to the first/last position in its current container. The existing Tree Placement rules, undo history, focus restoration, and title-free `N/M` live announcement apply. Escape, lost pointer capture, pointer cancellation, window blur, context invalidation, or release outside the list cancels and restores the presentation.

Reflow and placement:

- The preview never changes persisted `state.root`, group children, or `state.ungrouped`. The existing heterogeneous root array interleaves folders and positioned sources; the separate Ungrouped bin remains a root `listitem` with an owned inner list. A valid changed drop passes through Tree Placement and saves once. Cross-folder moves, whole folder subtrees, and the full logical multi-selection follow the same placement checks; a folder cannot move into itself or a descendant.
- Reflow prepares the dragged rows' measured physical footprint and folds them out of layout. Source window replacement re-resolves exact mounted rows, keeps off-window selected keys in the logical selection, and blocks a drop when its footprint or identity cannot be verified. The hover-expand timer, empty-Ungrouped drop hint, nested folder guide, and edge auto-scroll remain active.
- Each drag frame reads geometry before computing intent and writing styles. The stable `layoutRect` is obtained from visible rectangles by subtracting **current rendered** translation, including translated ancestors. Target slot calculation never uses the spring's moving screen position. Geometry is invalidated on scroll, resize, hover expansion, list replacement, or identity change; pointer release synchronously flushes dirty geometry before committing.
- Visible siblings move toward a target offset with one spring loop (`stiffness: 360`, `damping: 32`, `mass: 0.6`). Current position, velocity, and target remain separate, so a changed target retargets from the row's actual position. `content-drag-motion.js` owns the spring; `.sp-drop-shift` does not add a CSS transform transition over those frame-by-frame writes. Offscreen rows keep their geometric offset without scheduling hundreds of moving layers. `prefers-reduced-motion: reduce` applies the target immediately.
- The ghost follows pointer movement directly; only the neighboring rows spring. On a successful drop, the folded rows are restored and siblings FLIP from their actual pre-drop visual position using the same spring; the ghost springs into its landed row before being removed. Cancellation restores the folded rows and springs the shifts back without persisting a preview. Cleanup is idempotent so an immediate second drag cannot inherit stale transforms, fold classes, timers, or hover feedback.

Ownership and safeguards:

- `content-drag-pointer.js` owns pointer capture, threshold, cancellation, and handle keys. `content-tree-interactions.js` owns the shared `start / update / commit / cancel` flow, context validation, geometry, intent, and Tree Placement calls. `content-drag-reflow.js` owns measured folds and shift targets; `content-drag-motion.js` owns rendered spring positions. `content-drag-multi.js` supplies cloned layers and edge scrolling.
- Keep source keys and group IDs in separate typed maps. Preserve one read → pure plan → write sequence per frame; do not read geometry after writing a shift. Reject stale, mixed, incomplete, or cross-context selection before mutation. Always revalidate notebook and manager identity before saving.
- Keep the ghost and handle inside the Shadow DOM so the existing theme tokens, focus ring, light/dark colors, and row patterns apply. The classic insertion line is intentional and must remain available to users who explicitly selected `classic`.

## 14. Batch Mode

Batch mode adds a temporary command surface while preserving the base visual language.

Key elements:

- Source row selection state
- Batch checkbox variant
- Sticky batch action bar at the bottom
- Persistent selected count
- Select visible and Clear selection actions
- Add-to-folder and delete CTA variants

Batch action bar style:

- Glass background
- Radius `16px`
- Sticky to bottom
- Compact wrapping layout

Rules:

- Temporary mode UI should layer on top of the system, not replace it.
- When introducing a new mode, prefer banner + sticky action area rather than rebuilding the whole screen.
- With zero selected sources, render only Cancel, the selection count, and Select visible. Reveal clear-selection controls and the batch action group only after at least one source is selected.
- Select visible is scoped to sources that remain visible and operable after the current search, quick view, tag filter, isolation, and folder-collapse state. It must not silently select filtered, collapsed/hidden/inert, failed, loading, native-checkbox-less, or deletion-pending rows.
- Batch delete must skip sources without a native action menu, keep them selected for plugin-local organization, and explain the excluded count before or after deletion.

## 15. Popup UI Specification

The popup is intentionally simpler and more branded than the content panel.

Canonical popup traits:

- Width `360px`
- Internal padding `18px`
- Neutral tokenized page background: `--popup-page-bg`
- Tokenized light and dark theme surfaces
- Pill eyebrow badge
- Clear title/body/note hierarchy
- One strong full-width CTA
- Runtime enable/disable switch
- Notebook source-view segmented control when applicable

Popup status blocks:

- `.popup-note`: neutral helper surface
- `.popup-detail`: warning/detail surface
- `.popup-toggle`: extension enabled/disabled state surface
- `.popup-source-view`: list/label source-view segmented control

Rules:

- The popup should stay task-focused and concise.
- It is a launcher and status view, not a second control center.
- Avoid mirroring the full content-panel complexity in the popup.

## 16. Accessibility and UX Rules

The current UI already hints at several accessibility expectations. Future UI should preserve and improve them.

Required rules:

- Icon-only buttons must have `title` and `aria-label`.
- Repeated row controls must include the source or folder name in their accessible label.
- Keyboard-focusable controls must show a clear focus treatment.
- The source list and nested folder contents use owned `list` / `listitem` relationships. Root empty states and the batch surface use `listitem` wrappers; the batch commands remain a nested toolbar. The Ungrouped bin is one root list item with its own labeled inner list. Do not claim an ARIA tree unless the complete tree keyboard model is implemented.
- Folder carets synchronize `aria-expanded` and `aria-controls`. Collapsed child lists use both `aria-hidden="true"` and `inert`; expanding removes both blocks before focus can enter the descendants.
- Folder switches have an explicit `:focus-visible` ring, and source/group toggle labels describe the affected item rather than repeating a generic control name.
- Related control clusters and dynamic regions carry landmark/grouping semantics: the quick-view rail is `role="group"` (`ui_quick_view_rail_label`), the batch surface is a root `listitem` containing a `role="toolbar"` (`ui_batch_actions_region`), and the panel resizer is a focusable `role="separator"` (`aria-orientation="horizontal"`, `ui_panel_resizer_label`, `tabindex=0`) with dynamic `aria-valuemin`, `aria-valuemax`, `aria-valuenow`, and `aria-valuetext`. ArrowUp/ArrowDown steps height, clamps to the same per-view bounds as drag, updates those values, and persists the result. The toggle buttons that flip state (batch mode, quick-view, isolate) expose `aria-pressed`.
- Precise tree ordering uses the persistent `#sp-tree-order-status.sp-sr-only` polite/atomic live region. Success text contains only direction and canonical position `N/M`; it must never include private source titles, group names, tags, or URLs, and no-op commands must not announce success.
- After a successful precise-order render, focus returns by stable source key or group id + direction. If that control becomes disabled or lands inside a collapsed folder, use another enabled control for the same item, then the visible destination/parent folder caret as the fallback. Do not add a second Enter key handler: native buttons already translate Enter into one click.
- Folder precise-order controls use an absolutely positioned hover/focus surface so revealing them does not change row height or drag geometry. Keep the surface hidden and non-interactive while `#sources-list.sp-drag-active` is present.
- New UI copy must go through i18n.
- Disabled states must change both visuals and pointer behavior.
- Loading states must block interaction when the action cannot succeed.
- Empty, loading, error, and disabled states should exist for any non-trivial flow.
- Idle, saving, and saved states stay hidden in the manager and Settings surfaces. Failed, stale, and recovery-available states remain persistent; Retry, Refresh, Restore, and Dismiss stay adjacent to the state they resolve.
- `forced-colors: active` keeps the command combobox/options, shortcut control,
  resizer, active-option outline, and semantic foregrounds mapped to system
  colors. Do not disable forced-color adjustment for interactive controls unless
  an equivalent system-color treatment is supplied.
- `prefers-reduced-motion: reduce` collapses duration tokens and removes
  non-essential transitions/animations while preserving visible state changes,
  focus, and loading identification.
- At 240px and 320px panel widths, toolbars and batch actions wrap without
  shrinking controls below an operable size; modal content may scroll instead of
  clipping actions. At 200% and 400% browser zoom, the same rule applies: no
  essential control or status may require horizontal scrolling, overlap another
  action, or become hover-only.
- The sticky batch action bar is capped to the source-list viewport minus its safe inset and scrolls internally when the panel is short; it must not rise over the top toolbar.
- Batch toolbar buttons and selection status must override the shared button
  `white-space: nowrap` rule with bounded border-box sizing and wrapping. This
  prevents long translations and platform font metrics from increasing the
  toolbar's intrinsic width beyond the manager container.

Recommended rules:

- Preserve contrast between primary and secondary text in both themes.
- Keep critical action text readable without relying on color alone.
- Avoid hover-only discoverability for destructive actions if keyboard users also need them.

## 17. Motion and Feedback Rules by State

Use this as the default state matrix.

### Hover

- Slight background tint
- Small scale or reveal
- No large travel distance
- No dramatic bounce

### Active / pressed

- Scale down slightly
- Keep duration short
- Do not combine with large positional movement

### Focus

- Accent ring or accent-tinted container ring
- Prefer shadow/ring over heavy outline replacement unless necessary

### Disabled

- Lower opacity
- Remove misleading hover transforms
- Use not-allowed cursor only when appropriate

### Loading

- Show spinner or pulse
- Suppress controls that should not be interactive
- Preserve layout stability

### Selected

- Use accent tint and sometimes border
- Avoid full saturated fills unless semantic role demands it

### Destructive

- Danger tint on hover
- Danger color on icon/text
- Do not make all destructive actions red by default when idle

## 18. Implementation Rules for New Features

When adding new UI, follow this order.

1. Decide whether the UI belongs to the content panel or popup.
2. Reuse an existing token set.
3. Reuse an existing component class if the role matches.
4. If only a variant is needed, extend the base class.
5. Only create a new component class when the interaction model is actually different.

Practical rules:

- Prefer `sp-` classes and the Shadow DOM for content-panel UI.
- Add styles to `src/content/content-style-text.js`.
- Add structure via `src/content/content-template.js` only for shell-level elements.
- Keep `src/content/index.js` as the only bootstrap and side-effect entrypoint.
- Render list items, menus, banners, and mode bars from the content sidecars that own them.
- Reuse `patchChildren(...)` and fragment-based rendering.
- Reuse the shared easing curve unless there is a documented reason not to.
- Reuse the radius scale.
- Reuse semantic colors through tokens.
- Keep z-index within the documented layer system.

## 19. Anti-Chaos Rules

These rules exist specifically to keep the plugin from drifting.

### 19.1 No one-off styling

Do not add:

- random border radii
- random transition durations
- ad hoc shadows
- hardcoded colors for convenience

If a new visual value is needed, promote it to a token first.

### 19.2 No duplicate component concepts

Do not create:

- a second primary button style in the content panel
- a second tag style
- a second modal shell style
- a second action-menu pattern

If the component is conceptually the same, extend the existing one.

### 19.3 No new visual language without intent

Avoid introducing:

- loud gradients in the content panel
- neon/glow-heavy affordances
- oversized cards
- different interaction grammar in one isolated feature

If the product direction changes, change it deliberately across the system.

### 19.4 Avoid CSS cascade confusion

The current stylesheet already has some layered overrides.

For future work:

- Prefer editing the canonical rule instead of stacking another override later.
- If you must override, leave a short comment explaining why.
- If a selector already exists twice, consolidate it when touching that area.

## 20. Appearance Preferences Namespace

`PREFERENCES_KEY.appearance.*` 是纯视觉开关的命名空间。当前包含：
- `hoverSpotlightEnabled` — source/group header 悬浮蓝色光晕开关

新增视觉开关请放在该命名空间下，遵守：默认值保留当前已发布行为，归一化只在严格 `false` 时关闭。CSS gate 通过给 `#sources-plus-root` shadow host 加/移 `sp-appearance-*` class 实现。

## 21. Recommended PR Checklist for UI Work

Before merging a UI change, check:

- Does it use existing `sp-` or `popup-` naming?
- Does it reuse existing tokens?
- Does it match the documented radius scale?
- Does it use the standard easing curve and duration tier?
- Does it define hover, active, focus, disabled, and loading states when applicable?
- For tree ordering, does disabled state come from `resolveDirectionalTarget`, does one activation cause one mutation/save/render, and does focus survive render?
- Does it work in both light and dark mode?
- Do semantic foregrounds pass 4.5:1 text contrast and controls/indicators pass 3:1?
- Does it remain operable in forced colors, reduced motion, 240/320px panels, and 200%/400% zoom?
- Does it keep toolbar, row, and modal density consistent with existing UI?
- Does it use i18n strings?
- Does it stay inside the documented z-index system?
- Does it visually look like the same product?

## 22. Recommended Future Cleanup

This section is not mandatory for feature work, but it is worth doing over time.

1. Split content-panel tokens, components, overlays, and state styles into clearer sections or modules.
2. Consolidate duplicate selectors in `src/content/content-style-text.js`.
3. Introduce explicit token names for typography and spacing if the system grows.
4. ~~Consider replacing the inline folder emoji in group titles with a formal icon element for stricter consistency.~~ **Done** — group titles render a formal `sp-group-title-icon` (`google-symbols` "folder"), no emoji.
5. Keep popup and content-panel motion tokens aligned if either surface changes.

## 23. Canonical File Map

Use this map when updating UI. It lists UI / style / render / modal / toast modules only — pure state, persistence, message-routing, and logic modules live in `docs/PROJECT_DIRECTORY.md`.

- `src/content/content-style-text.js`: content-panel tokens, components, motion, overlays (Shadow-DOM `NSM_CONTENT_STYLE_TEXT` + global-overlay `NSM_GLOBAL_OVERLAY_STYLE_TEXT`)
- `src/content/styles.css`: native Gemini Notebook DOM overrides plus the `#sources-plus-root` inline-size container context — injected via manifest `content_scripts[0].css`, scoped under `.sources-plus-manager-active` for source-list hiding and under `body.sources-plus-native-action-active[data-nsm-native-action-active="true"]` for manager-owned native Material menu styling (the third CSS mechanism; lives in the page, not the Shadow DOM)
- `src/content/content-template.js`: shell structure and persistent tree-order live region
- `src/content/content-panel-dom.js`: source panel lookup, renderability, lifecycle scheduling helpers
- `src/content/content-source-actions.js`: source action menu state, precise-order submenu dispatch, menu models, native menu bridge
- `src/content/content-source-action-menu.js`: source action menu item generation, resolver-derived precise-order children, and failed-source menu variants
- `src/content/content-native-action-coordinator.js`: exclusive native-action lifecycle and operation-scoped host marker ownership
- `src/content/content-tags.js`: tag normalization, serialization, CRUD helpers
- `src/content/content-state-reconcile.js`: persisted source and tag reconciliation
- `src/content/content-persistence.js`: state load/save, schema normalization, lifecycle persistence
- `src/content/content-modals.js`: modal orchestration + shared modal helpers (prepareModalOpen / closeManagedModal, focus-trap glue, item stagger style, import-preview rendering, file/clipboard IO); delegates each modal's node-building to the `content-modal-*` sub-factories
- `src/content/content-modal-move.js`: move-to-folder modal — flattened group-tree picker, executes move of current/batch sources
- `src/content/content-modal-tag.js`: tag-management + batch-tag modals; reusable tag editor + tag color control (preset swatches + hex input)
- `src/content/content-modal-tag-filter.js`: quick-view "filter by tag" modal (single-select tag chips)
- `src/content/content-modal-command-palette.js`: standard combobox/listbox command palette, keyboard navigation, external shortcut action, and independent shortcut-recording dialog
- `src/content/content-modal-settings.js`: settings modal + quick-view visibility sub-modal + developer settings panel
- `src/content/content-modal-welcome.js`: first-run welcome modal; exports the feature-row builder reused by What's New + Settings
- `src/content/content-modal-whats-new.js`: post-upgrade What's New modal (reuses welcome feature rows, marks version seen)
- `src/content/content-toast.js`: Shadow-DOM toast queue/renderer (showToast / showUndoableToast); distinct from `content-toast-status.js` below (text normalization only)
- `src/content/content-modal-focus.js`: modal focus trap, Escape handling, and focus restoration helpers
- `src/content/content-native-label-import-modal.js`: native label import preview modal node generation
- `src/content/content-render.js`: fragment patching, icons, menu layer, resolver-derived group order controls, main render path
- `src/content/content-view-state.js`: search/filter/quick-view/isolation view-state helpers and effective-state sync
- `src/content/content-tree-interactions.js`: directional move adapter, focus/live-region feedback, tree mutations, rename, batch interactions, drag-and-drop
- `src/content/content-drag-reflow.js`: measured drag fold, slot geometry, and sibling shift targets (`prepareDragSession` / `foldDraggedItems` / `refreshMountedDragSession` / `computeReflow` / `applyReflow` / `clearReflow` / `unfoldDraggedItems`)
- `src/content/content-drag-pointer.js`: stable-list pointer capture, 3px start threshold, handle keyboard input, and cancellation
- `src/content/content-drag-motion.js`: shared frame loop for beUI spring positions and reduced-motion immediate placement
- `src/content/content-drag-multi.js`: multi-source drag — custom drag-ghost cloning/stacking (`.sp-drag-ghost*`) + edge auto-scroll
- `src/content/content-source-list-scan.js`: native source-list row scan and checkbox state extraction
- `src/content/content-native-label-scan.js`: native label group scan and label header count parsing
- `src/content/content-native-label-import.js`: native label import preview completeness helpers
- `src/content/content-native-label-import-controller.js`: native label import confirmation, source completion, and group reuse helpers
- `src/content/content-source-partial-sync-guard.js`: partial source-sync guard and importing-source merge helpers
- `src/content/content-source-sync.js`: fresh row lookup, source panel classification, DOM-driven source sync
- `src/content/content-toast-status.js`: toast parameter normalization and save-status message helpers
- `src/content/content-diagnostics.js`: diagnostics and sanitized error summary helpers
- `src/content/content-source-view-switch-controller.js`: popup/native source-view switch request state helpers
- `src/content/index.js`: singleton state ownership, bootstrap, lifecycle, event binding, sidecar orchestration
- `src/popup/styles.css`: popup styling
- `src/popup/index.js`: popup state and copy logic
- `src/utils/index.js`: safe DOM helper, debounce, i18n helper

If a future feature touches UI and does not clearly fit into this map, stop and decide the ownership before implementing it.
