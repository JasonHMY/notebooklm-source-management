# NotebookLM Source Management UI Guidelines

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

- Content panel UI inside NotebookLM.
- Browser action popup UI used as a launcher/status page.

These two surfaces are intentionally different:

- The content panel is compact, utility-heavy, and embedded into NotebookLM.
- The popup is a small, branded launcher with a single primary action.

Do not mix the two styling systems casually.

### 2.2 Content panel implementation

The main manager UI is implemented by the content script and injected into the NotebookLM page.

Implementation flow:

1. `src/content/index.js` finds the NotebookLM source panel.
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

- The content panel uses Shadow DOM to isolate styles from NotebookLM.
- DOM is built with the shared `el(...)` helper from `src/utils/index.js`.
- UI strings should come from `chrome.i18n` via `getMessage(...)`.
- Re-rendering is state-driven and uses fragment patching, not `innerHTML`.
- Event handling is largely delegated from container nodes.

### 2.3 Global overlay exception

Shadow DOM cannot style some NotebookLM-native Angular Material overlays, menus, or dialogs. Because of that, the extension also injects global overlay CSS into `document.head`.

This is handled through `NSM_GLOBAL_OVERLAY_STYLE_TEXT`.

Use this path only when a UI element lives outside the Shadow DOM tree, for example:

- Native Angular Material menu panels
- Native dialogs

If a new UI can be kept inside the Shadow DOM, keep it there.

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
- Source view segmented control when a NotebookLM notebook tab is active
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

## 5.1 Color tokens

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
- `--sp-accent: #007aff`
- `--sp-accent-danger: #ff3b30`
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
- `--sp-accent: #0a84ff`
- `--sp-accent-danger: #ff453a`
- `--sp-accent-success: #30d158`

Semantic usage:

- Accent blue: interactive focus, selected state, tag-active state, reorder hints.
- Danger red: destructive actions, failed imports, delete affordances.
- Success green: enabled group switch.
- Secondary neutrals: passive chrome, tags, badges, helper text.

Rules:

- New UI must use existing semantic tokens first.
- If a new color is needed, add a token before using a literal value.
- Avoid one-off colors in component rules.

## 5.2 Border tokens

Current shared borders:

- `--sp-border-light: rgba(...)`
- `--sp-border-medium: rgba(...)`
- `--sp-border-checkbox: rgba(...)`

Rules:

- Default container or quiet control border: `--sp-border-light`
- Hover-strength border or stronger separation: `--sp-border-medium`
- Custom checkbox outline: `--sp-border-checkbox`

## 5.3 Shadow tokens

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

## 5.4 Radius scale

The current UI consistently uses a small set of radius values.

Canonical radius scale:

- `3px`: resizer bar
- `4px`: source icon images copied from NotebookLM or extension assets
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

## 5.5 Typography scale

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

## 5.6 Icon scale

Current icon sizes:

- `16px`: row icons, action buttons, tag row buttons, menu icons
- `18px`: toolbar icon buttons
- `20px`: caret, folder option icon

Rules:

- `16px` is the default for list-level action UI.
- `18px` is for toolbar-level icon buttons.
- `20px` is reserved for navigational or modal list items.

## 5.7 Motion system

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

## 5.8 Z-index layers

Current practical layer system:

- `5`: sticky batch bar
- `20`: sticky controls
- `9999`: toast
- `10000`: overlay backdrop
- `10001`: modal
- `10002`: source action menu layer

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
- compact horizontal layout
- bottom border for separation
- no heavy visual chrome

Toolbar actions live in `.sp-toolbar-actions`.

Rules:

- Top-level actions should remain in a single horizontal strip.
- New top-level actions must be justified as "frequently used, global, and not row-scoped".
- Do not overload the toolbar with low-frequency actions.

### 7.2 Search behavior

The search UI uses an expandable container:

- Default compact icon state
- Expanded on interaction
- Collapses the toolbar action width when open
- Uses `focus-within` ring on the container

Search implementation details:

- Container: `.sp-search-container`
- Input: `#sp-search`
- Icon button: `#sp-search-btn`
- Search is debounced at `300ms`
- Enter triggers immediate search

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

The source list keeps a small bottom safe area so the final row can scroll above the resizer and NotebookLM's native add/search controls instead of being clipped in dense All view.

## 8. Buttons

## 8.1 Primary panel button: `.sp-button`

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
- Active: `scale(0.95)`
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

## 8.2 Icon button: `.sp-icon-button`

Canonical style:

- Padding: `4px`
- Radius: `8px`
- No border
- Default secondary text color
- Hover: hover-surface background + `scale(1.08)`
- Active: `scale(0.85)`

Use for:

- Search toggle
- Compact chrome actions

Rules:

- Icon-only controls must have `title` and `aria-label`.
- Do not use `.sp-icon-button` for destructive actions without an explicit semantic override.

## 8.3 Row action button family

Classes:

- `.sp-source-actions-button`
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
- Hover scale: `1.1`
- Active scale: `0.85`

Special behavior:

- Source action button defaults to partial opacity and becomes fully visible on row hover.
- Group secondary actions stay hidden until hover and reveal with opacity + translate + scale.
- Delete hover uses red tint and danger color.
- Isolate active state uses accent tint.

Rules:

- Row actions should not always be fully visible unless the action is critical.
- Reveal-on-hover is the default for row-scope secondary actions.

## 8.4 Popup button

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

## 9. Selection Controls

## 9.1 Source checkbox: `.sp-checkbox`

Canonical style:

- `18 x 18`
- Radius `6px`
- Thick border
- Accent fill on checked
- Custom-drawn checkmark with pseudo-element

Feedback:

- Hover: accent border + `scale(1.05)`
- Direct user selection can use the `.is-animating` organic checkmark draw.
- Programmatic sync and batch selection should use the default state transition without replaying the pop animation.

Rules:

- New checkbox-like controls should reuse `.sp-checkbox` unless there is a very strong reason not to.
- Avoid native browser checkbox visuals for in-panel controls.

## 9.2 Group switch

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

## 10.1 Source row

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
- `dragging`: state marker only (cursor: grabbing). The actual visual reaction is `.sp-drag-folded` (height/opacity → 0, fully collapsed). See 13.4.

Rules:

- New row-level visuals must respect the same density and feedback language.
- Do not add permanent heavy borders around normal rows.
- The title area should remain the primary click target.

## 10.2 Group row

Classes:

- `.group-container`
- `.group-header`
- `.group-children`

Canonical traits:

- Same motion language as source rows
- Heavier emphasis through weight and hierarchy, not loud color
- Indentation driven by inline `padding-left: level * 20px`
- Tree line via left border on `.group-children`

Group header contents:

1. Caret
2. Enable switch
3. Group title
4. Count badge
5. Secondary hover actions

Feedback:

- Same lift behavior as row hover
- Caret rotates on collapse
- Child tree line turns accent on group hover

Rules:

- Group UI must feel structurally related to source rows, not like a separate product.
- Future nested controls must not break indentation rhythm or tree-line clarity.

## 10.3 Drag and drop feedback

Existing cues:

- Dragged item folds out of the list (height/opacity → 0) so the layout reads "the item has left its slot"; siblings at and after the pointer translate down to open a slot that follows the cursor
- A custom source-row clone ghost (`.sp-drag-ghost`) follows the pointer; single drag uses one clone, multi drag stacks up to three clones with a count badge
- Drop target group gets an accent-tinted header (`.drag-into`)
- Invalid drop targets surface a red outline on the slot top item (or red group header). Because the dragged row itself is folded out (height/opacity 0), the warning lives on a sibling slot and is never obscured by the dragged item.
- On successful drop, the landed row gets a 200ms in-place animation + 600ms accent outline flash so the user's eye catches the new location. Single-source uses FLIP fly-in (from cursor to slot); multi-source uses scaleY (per element).
- On dragend cancel (esc / drop outside), the dragged row smoothly grows back from height 0 to natural over 200ms, paired with sibling translateY clearing — no instant snap.
- Empty drop zones enlarge slightly and tint on valid target hover

Rules:

- All drag affordances should use accent blue (valid) or danger red (invalid) and subtle scaling.
- Do not introduce unrelated colors or large shake animations.
- See 13.4 for the canonical physical-reflow timing, classes, and rules.

## 11. Titles, Tags, Badges, and Metadata

## 11.1 Title blocks

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

## 11.2 Tag pills

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

## 11.3 Badges

Class: `.badge`

Use for:

- Group counts
- Small numeric summaries

Rules:

- Keep badges compact and quiet.
- Badges are metadata, not actions.

## 11.4 Tag color editor

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

Feedback:

- Swatch hover uses the same shared panel easing as other controls
- Active swatch uses the standard accent focus ring language
- Text input focus uses the same soft accent focus ring as other modal inputs

Rules:

- New tag-color affordances should extend this editor, not introduce a second color-picker pattern
- If color presets change, keep the interaction model the same: presets, custom trigger, and editable hex field
- Do not use loud animations or independent color-picker chrome inside the modal

## 12. Menus, Overlays, and Modals

## 12.1 Source action menu

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

- Hover: menu row tint + `translateX(2px)`
- Icons brighten with hover

Rules:

- Small contextual menus should follow this glass popover pattern.
- Do not create solid opaque dropdowns for content-panel context menus.

## 12.2 Modal system

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
- Same system font stack as `.sp-container`; modal nodes mount outside the container and must not inherit NotebookLM page typography.

Motion:

- Backdrop fades in
- Modal scales and settles in from slightly above
- Exit reverses with slight upward drift

Rules:

- New panel-owned modal dialogs should reuse this shell.
- Footer actions should be right-aligned.
- Backdrop click may dismiss only when safe.

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

- Lightweight preferences such as language, history retention, command palette entry, and quick view button management should use `.sp-settings-preference-row`.
- Keep preference copy short and functional; do not add explanatory cards inside settings sections.

Command palette:

- `.sp-command-palette-modal` uses the same modal shell and focus trap.
- It is opened from the Settings preferences section; command rows also expose a compact shortcut control.
- No command ships with a default shortcut. Users may assign their own modifier-based shortcuts, and those shortcuts are stored in global preferences.
- Repeating a user-defined shortcut should reverse reversible command state where possible: collapse search, clear an active quick view, or close the corresponding modal.
- Commands should bridge to existing manager actions instead of duplicating business logic.
- Batch commands must remain disabled until batch mode has selected sources.

## 12.3 Option lists inside modals

Classes:

- `.sp-folder-option`
- `.sp-tag-option`
- `.sp-tag-row`

Canonical style:

- Radius `10px`
- Dense rows
- Clear icon/title separation
- Hover scale slightly down to feel pressable, not floating

Rules:

- Use list-row interaction language, not card-grid language, for modal choice lists.

## 13. Temporary and Informational Surfaces

## 13.1 View state banners

Class: `.sp-view-banner`

Used for:

- Active isolation mode
- Active tag filter

Canonical style:

- Quiet contextual surface
- Border + gentle background
- Compact CTA on the right

Rules:

- View-state banners are for temporary mode context only.
- Do not use them for permanent settings.

## 13.2 Toast

Class: `.sp-toast`

Canonical behavior:

- Bottom center
- Blurred dark or light surface depending on theme
- Entrance from below with opacity + blur cleanup

Rules:

- Use toast for short confirmation only.
- Do not use toast for workflows that require decision-making.

## 13.3 Empty states

Class: `.sp-empty-state`

Canonical style:

- Dashed border
- Centered text
- Subtle neutral background
- Slight scale-up when used as a drop target

Rules:

- Empty states should be quiet and actionable.
- Prefer one clear message over illustration-heavy placeholders.

## 13.4 Drag interaction (physical reflow)

Classes: `.dragging` (state marker), `.sp-drag-folded`, `.sp-drag-unfolding`, `.sp-drop-shift`, `.sp-drag-ghost`, `.sp-drag-ghost-single`, `.sp-drag-ghost-stack`, `.sp-drag-ghost-layer`, `.sp-drag-ghost-badge`, `.sp-drop-landing`, `.sp-drop-flying`, `.sp-drop-landed`, `.drag-into`, `.drag-invalid`, `.sp-pseudo-hover` (post-drop), `.sp-drag-active` (post-drop, on `#sources-list`), `.sp-drag-guide` (folder left-guide extension while a child is folded)

Canonical behavior:

- On dragstart the dragged item(s) fold out of the list: `height` collapses from the cached `offsetHeight` to `0` and `opacity` fades to `0` (`.sp-drag-folded`). Multi-source drag folds every selected row in the same frame.
- During dragover, siblings at and after the target insertion index translate down by `N × itemHeight` (`.sp-drop-shift` with inline `transform: translateY(...)`). The visible gap that follows the pointer is the insertion slot — there is no separate insertion bar.
- A folded child removes its **layout** height from its parent `.group-children`, but the reflow-shifted siblings still occupy that space **visually** (transform doesn't change layout) — so the folder's `border-left` guide bar (blue on `:hover`) would stop short of the bottom. `foldDraggedItems` tallies each folded child's height onto its parent and sets `--sp-fold-comp` + `.sp-drag-guide`; CSS draws an absolute `::before` of `height: calc(100% + var(--sp-fold-comp))` so the guide spans the full folder **without entering layout** (it cannot disturb reflow / cross-host shifts). `unfoldDraggedItems` clears it; preflight strips it as a backstop.
- The drag ghost is a 1:1 clone of the actual source-item row (icon, title, tags) with inline-resolved computed styles so it renders identically outside the Shadow DOM. Single-source drag wraps the clone with `.sp-drag-ghost-single` (transform scale 0.95 + drop-shadow). Multi-source drag stacks the first three clones via `.sp-drag-ghost-stack` (each `:nth-child` offset + rotated + scaled, layers 2/3 dimmed) with a circular `.sp-drag-ghost-badge` at top-right showing the total selection count N.
- `setDragImage` offset is computed from the pointer's position inside the origin row's bounding rect (`clientX − rect.left`, `clientY − rect.top`, clamped to `[0, rect.width/height]`); the ghost stays aligned under the pointer instead of leaping to a fixed offset.
- On drop, transforms zero out before the DOM order changes so the new order is rendered in place. On dragend or cancel the dragged items unfold (height/opacity restore) and all shifted siblings return to `translateY(0)`.
- Invalid drop highlights the slot top item with `.drag-invalid` (red outline-style treatment) instead of tinting the hovered row's box-shadow, so a row's normal `:hover` lift cannot obscure the warning. Group-into invalid drops still color the group header via `.group-container.drag-invalid > .group-header`.
- After a successful drop, the landed element animates in. Single-source drops use the **FLIP fly-in** path (`.sp-drop-flying`): JS reads the cursor's drop position and the landed element's destination rect, sets inline `transform: translate(dx, dy)` so the element starts at the cursor, force-reflows, then clears the transform so the transition (200ms cubic-bezier(0.2, 0, 0, 1)) carries it back into the slot — visually the source snaps from where the user released to its final spot. Multi-source / group drops use `.sp-drop-landing` instead (200ms scaleY 0→1 + opacity 0→1 from top) because N elements flying from a single cursor point look like a confusing scatter. Both paths concurrently add `.sp-drop-landed` (600ms accent outline flash via box-shadow, same easing). All classes + inline styles auto-clear on `animationend` with a setTimeout(800ms) backstop. Disabled under `prefers-reduced-motion: reduce`.
- On dragend cancel (esc / drop outside the list), `unfoldDraggedItems({ animated: true })` swaps `.sp-drag-folded` → `.sp-drag-unfolding` and writes the cached natural height + opacity 1 as inline values so the dragged row smoothly grows back over 200ms. Paired with `clearReflow`'s translateY transition on shifted siblings, so the dragged item's growth and the siblings' slide-back stay visually synchronized.
- `handleDragStart` preflights by stripping any lingering `.sp-drop-flying` / `.sp-drop-landing` / `.sp-drop-landed` / `.sp-drag-unfolding` classes from the source list. Prevents the previous drop's 800ms cleanup window from leaking a stale transition rule onto the new drag's fold (which would silently turn instant fold into a 200ms animation and re-introduce reflow jitter).
- After a successful `handleDragEnd`, Chrome's native `:hover` stays frozen on the dragstart element until the user moves the mouse for real, and because the list re-uses DOM nodes in place, that row is now displaying a different source. To stop the "wrong row stays highlighted" symptom, `handleDragEnd` installs `.sp-drag-active` on `#sources-list` (suppression CSS for the stale `:hover`) and `.sp-pseudo-hover` on whichever row is actually under the cursor (re-paints the hover affordance there). Both classes are removed by a single document-level capture listener on the first **trusted** `mousemove` / `mouseover` / `mousedown` (`event.isTrusted` is gated so `handleDragEnd`'s own synthetic `mousemove` does not tear them down immediately). A 1.5s `setTimeout` is the backstop.

Motion:

- **Fold is instant** (no transition on `.sp-drag-folded`): the dragged item leaves layout in one frame so its height collapse doesn't run in parallel with the sibling reflow translateY transition and produce jitter.
- **Unfold (`.sp-drag-unfolding` on cancel), reflow shift (`.sp-drop-shift`), single-source fly-in (`.sp-drop-flying`), multi-source landing (`.sp-drop-landing`)** all use `200ms cubic-bezier(0.2, 0, 0, 1)`. **Drop landing flash (`.sp-drop-landed`)** uses the same curve at `600ms`. This is a deliberate one-off curve for the physical-drag system — do not promote it into the shared motion tokens (`--sp-ease-standard` etc.) and do not pull standard / emphasized easing here.
- `transform` uses GPU compositing (`will-change: transform` on `.sp-drop-shift` and `.sp-drop-flying`).
- `@media (prefers-reduced-motion: reduce)` disables all drag animations + transitions; `setTimeout(800ms)` backstop still removes drop landing classes.

Implementation notes:

- Reflow logic lives in `src/content/content-drag-reflow.js` (`prepareDragSession`, `foldDraggedItems`, `computeReflow`, `applyReflow`, `clearReflow`, `unfoldDraggedItems`). `content-tree-interactions.js` calls these from dragstart / dragover / drop / dragend.
- Ghost cloning lives in `src/content/content-drag-multi.js` (`cloneSourceItem` / `inlineStylesRecursive`). `createMultiDragGhost({ count, sourceClones, root })` builds the single-vs-stack wrapper + badge from pre-cloned + style-inlined Elements.
- Insertion position is computed by `computeDropIntent` in `content-tree-interactions.js` as a pure pointer-Y → list → slot mapping against each element's *un-shifted layout top* (`rect.top - extractInlineTranslateY(el)`), so the active reflow shift on a sibling does not feed back into intent detection. The deepest group-container whose un-shifted children-area contains the pointer wins (via parent-map depth), then mid-Y of its direct children selects the slot. Never derive intent from `e.target.closest()` during a drag — the rendered (visual) layout includes transform shifts.
- `.dragging`, `.sp-drag-folded`, `.sp-drag-unfolding`, `.sp-drop-shift`, `.sp-drop-landing`, `.sp-drop-flying`, `.sp-drop-landed`, `.drag-into`, `.drag-invalid`, `.sp-pseudo-hover`, `.sp-drag-active`, `.sp-drag-guide` styles all live in `contentStyleText` (Shadow DOM scope).
- `.sp-drag-ghost`, `.sp-drag-ghost-single`, `.sp-drag-ghost-stack`, `.sp-drag-ghost-layer`, `.sp-drag-ghost-badge` styles live in `globalOverlayStyleText` because the ghost element is appended to `document.body` for the native drag-image capture, and Shadow DOM tokens do not reach it. Resolved light/dark accent values are hardcoded with a `@media (prefers-color-scheme: dark)` override on the badge background. `.sp-drag-ghost-layer` is an inner wrapper around each cloned source-item — it carries the stack/single transform + drop-shadow so the clone's inline `cssText` (written by `inlineStylesRecursive` to resolve Shadow DOM tokens outside the shadow tree) doesn't override the positional transforms.

Rules:

- Do not reintroduce blue-bar insertion indicators (`.drag-over-top` / `.drag-over-bottom`) — the moving slot itself is the insertion indicator.
- Do not introduce a new ghost variant for other drag flows without a clear UX reason; reuse `.sp-drag-ghost`.
- Do not animate the ghost element itself (it lives ~200ms; transitions would conflict with the browser's drag-image capture).
- Do not add interactive elements to the ghost (it is `pointer-events: none` and `aria-hidden`).
- Do not change the 200ms / `cubic-bezier(0.2, 0, 0, 1)` timing in isolation. Unfold, reflow shift, fly-in, and landing scaleY must all share that 200ms beat (and flash uses the same easing at 600ms) so the system feels coordinated. Fold stays instant on purpose — adding a transition there re-introduces dragged-item collapse + sibling reflow parallel-animation jitter.

## 14. Batch Mode

Batch mode adds a temporary command surface while preserving the base visual language.

Key elements:

- Source row selection state
- Batch checkbox variant
- Sticky batch action bar at the bottom
- Add-to-folder and delete CTA variants

Batch action bar style:

- Glass background
- Radius `16px`
- Sticky to bottom
- Compact horizontal layout

Rules:

- Temporary mode UI should layer on top of the system, not replace it.
- When introducing a new mode, prefer banner + sticky action area rather than rebuilding the whole screen.

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
- Keyboard-focusable controls must show a clear focus treatment.
- New UI copy must go through i18n.
- Disabled states must change both visuals and pointer behavior.
- Loading states must block interaction when the action cannot succeed.
- Empty, loading, error, and disabled states should exist for any non-trivial flow.

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
- Does it work in both light and dark mode?
- Does it keep toolbar, row, and modal density consistent with existing UI?
- Does it use i18n strings?
- Does it stay inside the documented z-index system?
- Does it visually look like the same product?

## 22. Recommended Future Cleanup

This section is not mandatory for feature work, but it is worth doing over time.

1. Split content-panel tokens, components, overlays, and state styles into clearer sections or modules.
2. Consolidate duplicate selectors in `src/content/content-style-text.js`.
3. Introduce explicit token names for typography and spacing if the system grows.
4. Consider replacing the inline folder emoji in group titles with a formal icon element for stricter consistency.
5. Keep popup and content-panel motion tokens aligned if either surface changes.

## 23. Canonical File Map

Use this map when updating UI.

- `src/content/content-style-text.js`: content-panel tokens, components, motion, overlays
- `src/content/content-template.js`: shell structure
- `src/content/content-panel-dom.js`: source panel lookup, renderability, lifecycle scheduling helpers
- `src/content/content-source-actions.js`: source action menu state, menu models, native menu bridge
- `src/content/content-source-action-menu.js`: source action menu item generation and failed-source menu variants
- `src/content/content-tags.js`: tag normalization, serialization, CRUD helpers
- `src/content/content-state-reconcile.js`: persisted source and tag reconciliation
- `src/content/content-persistence.js`: state load/save, schema normalization, lifecycle persistence
- `src/content/content-modals.js`: move-to-folder, tag management, command palette, settings, welcome, and import preview modals
- `src/content/content-modal-focus.js`: modal focus trap, Escape handling, and focus restoration helpers
- `src/content/content-native-label-import-modal.js`: native label import preview modal node generation
- `src/content/content-render.js`: fragment patching, icons, menu layer, main render path
- `src/content/content-view-state.js`: search/filter/quick-view/isolation view-state helpers and effective-state sync
- `src/content/content-tree-interactions.js`: tree mutations, rename, batch interactions, drag-and-drop
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
