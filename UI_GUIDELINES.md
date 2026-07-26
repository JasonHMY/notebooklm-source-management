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
- `dragging`: state marker only (cursor: grabbing). The actual visual reaction is `.sp-drag-folded` (height/opacity → 0, fully collapsed). See 13.4.

Rules:

- New row-level visuals must respect the same density and feedback language.
- Do not add permanent heavy borders around normal rows.
- The title area should remain the primary click target.

### 10.2 Group row

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

### 10.3 Drag and drop feedback

Source and group rows participate in the physical-reflow drag system. Row-level summary:

- The dragged row folds out of the list (`.sp-drag-folded`, height/opacity → 0) and the rows after the pointer open a slot that follows the cursor — the moving gap *is* the insertion indicator.
- A row-clone ghost (`.sp-drag-ghost`) follows the pointer; the drop-target group shows an accent header (`.drag-into`); an invalid drop shows a red outline on the slot's top item or the group header, never on the folded row.

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

Command palette:

- `.sp-command-palette-modal` uses the same modal shell and focus trap.
- It is opened from the Settings preferences section; command rows also expose a compact shortcut control.
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

## 13. Temporary and Informational Surfaces

### 13.1 View state banners

Class: `.sp-view-banner`

Used for:

- Active isolation mode
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

### 13.4 Drag interaction (physical reflow)

**Two drag modes (preference `dragMode`).** This section describes the **reflow (Beta)** mode (`dragMode: 'reflow'`). The default **classic** mode (`dragMode: 'classic'`, = the 26.5.26 experience) does NOT fold/reflow: the dragged row stays in place (dimmed `.dragging`), and the drop slot is shown by a blue insertion line on the target row's edge — `.drag-over-top` (before) / `.drag-over-bottom` (after) with an accent dot (`::before`/`::after`), restored in `contentStyleText`. `.drag-into` (folder header highlight) is shared by both modes; the reflow `.sp-drag-guide` bar, `.sp-drag-folded` fold, `.sp-drop-shift` reflow, and the fly-in/landing animation are reflow-only (gated on `getDragMode()`). Classic also never positions a loose source at root — `computeDropIntent` demotes such a drop to the bottom Ungrouped bin (v4 behavior). The toggle lives in Settings → Appearance ("Enable reflow drag (Beta)", default off); the What's-New modal offers a one-tap enable. Switching to Classic and every subsequent notebook load enforce the same placement invariant: after preferences and any deferred state restore are verified, positioned root sources are checkpointed and swept into the Ungrouped bin (`sweepPositionedRootSourcesToBin`). An unavailable or failed preference load never treats the in-memory Classic default as verified and therefore never sweeps. The migration save is immediate, critical, excluded from undo history, and retains recovery data if persistence fails.

Classes: `.dragging` (state marker), `.sp-drag-folded`, `.sp-drag-unfolding`, `.sp-drop-shift`, `.sp-drag-ghost`, `.sp-drag-ghost-single`, `.sp-drag-ghost-stack`, `.sp-drag-ghost-layer`, `.sp-drag-ghost-badge`, `.drag-into`, `.drag-invalid`, `.drag-over-top` / `.drag-over-bottom` (classic blue insertion line), `.sp-pseudo-hover` (post-drop), `.sp-drag-active` (during-drag + post-drop, on `#sources-list`), `.sp-drag-guide` (folder left-guide extension while a child is folded), `.sp-ungroup-dropzone` (transient "move to ungrouped" hint mounted at the list bottom when the ungrouped bin is empty)

Canonical behavior (reflow / Beta mode):

- The root level renders folders and "positioned" loose sources **interleaved in `state.root` order** (a heterogeneous ordered array of `{ type:'group', id }` / `{ type:'source', key }` entries), so a source can sit between two folders, above all folders, or below them. The bottom "Ungrouped" bin (the bucket for newly imported / explicitly un-positioned sources) is wrapped in a `.ungrouped-section` container under an `.ungrouped-header` label. Wrapping the bin means its `.source-item` rows are **not** direct children of `#sources-list`, so `computeDropIntent`'s root scan only sees `state.root` entries — the bin is resolved as its own separate drop region.
- On dragstart the dragged item(s) fold out of the list: `height` collapses from the cached `offsetHeight` to `0` and `opacity` fades to `0` (`.sp-drag-folded`). Multi-source drag folds every selected row in the same frame.
- During dragover, siblings at and after the target insertion index translate down by `N × itemHeight` (`.sp-drop-shift` with inline `transform: translateY(...)`). The visible gap that follows the pointer is the insertion slot — there is no separate insertion bar.
- The folder left-guide bar tracks the **drop target**, not the origin. Each frame `_processDragOver` marks the folder the pointer is currently inside (`intent.hostGroupContainerEl` — `into-group` or a slot within an expanded folder) with `.sp-drag-guide` + `--sp-slot-comp` (= `totalDraggedHeight`), clearing the previous frame's marker first. CSS draws that folder's guide as an absolute `::before` of `height: calc(100% + var(--sp-slot-comp))`, colored blue — so it spans the folder's content **plus one insertion slot**, previewing where the source lands (including the empty slot when dropping at the very end), **without entering layout** (cannot disturb reflow / cross-host shifts). Every other folder keeps its plain grey `border-left`, which naturally ends at its last item. Because Chrome freezes native `:hover` on the origin folder at dragstart, `handleDragStart` adds `.sp-drag-active` to `#sources-list` for the whole drag so `#sources-list.sp-drag-active` can suppress that frozen `:hover` blue (the bar is owned exclusively by `.sp-drag-guide`). The guide is cleared per-frame + on dragend (`clearDragFeedback`), with preflight as a backstop; `.sp-drag-active` is torn down by the post-drop trusted-pointer cleanup / preflight.
- The drag ghost is a 1:1 clone of the actual source-item row (icon, title, tags) with inline-resolved computed styles so it renders identically outside the Shadow DOM. Single-source drag wraps the clone with `.sp-drag-ghost-single` (transform scale 0.95 + drop-shadow). Multi-source drag stacks the first three clones via `.sp-drag-ghost-stack`: the top layer (`:nth-child(1)`) is only scaled (`scale(0.95)`, no offset/rotate), while layers 2 and 3 are offset + rotated + scaled and dimmed (opacity `0.85` / `0.7`). A circular `.sp-drag-ghost-badge` at top-right shows the total selection count N.
- `setDragImage` offset is computed from the pointer's position inside the origin row's bounding rect (`clientX − rect.left`, `clientY − rect.top`, clamped to `[0, rect.width/height]`); the ghost stays aligned under the pointer instead of leaping to a fixed offset.
- On drop, transforms zero out before the DOM order changes so the new order is rendered in place. On dragend or cancel the dragged items unfold (height/opacity restore) and all shifted siblings return to `translateY(0)`.
- Invalid drop highlights the slot top item with `.drag-invalid` (red outline-style treatment) instead of tinting the hovered row's box-shadow, so a row's normal `:hover` lift cannot obscure the warning. Group-into invalid drops still color the group header via `.group-container.drag-invalid > .group-header`.
- When the ungrouped bin is **empty** and a source is dragged near the very bottom of the list, the intent is flagged `isEmptyBinTrailing` (the trailing slot below the last `state.root` entry that routes the source back into `state.ungrouped`). `_processDragOver` reads that flag (passed through verbatim on `runtime.dragReflowSession.currentIntent`) and mounts a transient `.sp-ungroup-dropzone` hint into the opened trailing slot — a dashed accent-bordered "move to ungrouped" panel (`ui_drop_to_ungroup_hint`), `pointer-events: none`, removed when the cursor leaves the trailing region or the drag ends. Without the hint the empty bin would be an invisible target, since there is no row to reflow against.
- After a successful drop, `applyDropLandingAndFlash(landedKeys, _cursorX, _cursorY, preRects)` runs a **direction-neutral** finishing beat (single- and multi-source share one path; the earlier directional `.sp-drop-flying` cursor→slot fly-in, `.sp-drop-landing` scaleY-from-top, and `.sp-drop-landed` accent flash were removed because their built-in direction read as a confusing scatter). Two animations run in parallel: (1) the landed rows get a plain `opacity` 0→1 fade-in (no transform/scaleY/slide — appears in place); (2) siblings **FLIP** from their pre-drop visual position (captured in `preRects` before the state mutation + render) to the new layout via `.sp-drop-shift` (`transform: translateY(...)` → `''` with `.sp-drop-shift`'s transform transition). Before either, the post-drop render's `.sp-list-item-enter` is stripped from every row (drop is a reorder, not new rows — leaving it on makes all rows shimmer), and each row's base transform transition is briefly suppressed (inline `transition: none`) then restored via RAF so cleared sibling `translateY` doesn't auto-slide. The `_cursorX` / `_cursorY` params are retained for caller compatibility but unused. Disabled under `prefers-reduced-motion: reduce`.
- On dragend cancel (esc / drop outside the list), `unfoldDraggedItems({ animated: true })` swaps `.sp-drag-folded` → `.sp-drag-unfolding` and writes the cached natural height + opacity 1 as inline values so the dragged row smoothly grows back on the shared base-motion beat (`var(--sp-motion-base)` = 180ms). Paired with `clearReflow`'s translateY transition on shifted siblings, so the dragged item's growth and the siblings' slide-back stay visually synchronized.
- `handleDragStart` preflights by stripping any lingering drag-feedback classes from the source list and resetting their backing inline styles — `.sp-drag-folded` (+ height/opacity), `.sp-drop-shift` (+ transform), `.sp-drag-unfolding`, `.sp-pseudo-hover`, `.sp-hover-expand-pending`, `.sp-drag-cancelled` (plus legacy-defensive removes of `.sp-drop-flying` / `.sp-drop-landing`, which are no longer applied). Prevents a prior drag that was interrupted (tab-switch / blur) before its own cleanup ran from leaking stale visual state (a stuck-folded row, offset siblings, a frozen outline) into the new drag. Costs nothing on the common path (`querySelectorAll` returns 0 nodes).
- After a successful `handleDragEnd`, Chrome's native `:hover` stays frozen on the dragstart element until the user moves the mouse for real, and because the list re-uses DOM nodes in place, that row is now displaying a different source. To stop the "wrong row stays highlighted" symptom, `handleDragEnd` installs `.sp-drag-active` on `#sources-list` (suppression CSS for the stale `:hover`) and `.sp-pseudo-hover` on whichever row is actually under the cursor (re-paints the hover affordance there). Both classes are removed by a single document-level capture listener on the first **trusted** `mousemove` / `mouseover` / `mousedown` (`event.isTrusted` is gated so `handleDragEnd`'s own synthetic `mousemove` does not tear them down immediately). A 1.5s `setTimeout` is the backstop.

Motion:

- **Fold is animated**: `.sp-drag-folded` transitions height/opacity/padding/margin/border-width on the shared `var(--sp-motion-base) var(--sp-ease-emphasized)` beat, so the origin row collapses in sync with the sibling reflow. Safe because slot-based geometric drop detection no longer reads layout reflow, so fold-height and reflow-translateY animate in parallel without feedback jitter (see the comment above `.sp-drag-folded` in content-style-text.js).
- **Unfold (`.sp-drag-unfolding` on cancel)** and **reflow shift (`.sp-drop-shift`)** both transition on `var(--sp-motion-base) var(--sp-ease-emphasized)` (the shared base-motion beat), so the dragged item's grow-back and the siblings' slide-back stay coordinated. The post-drop landed-row fade-in is opacity-only on the same base beat.
- `transform` uses GPU compositing (`will-change: transform` on `.sp-drop-shift`).
- The `.sp-ungroup-dropzone` hint fades + rises in on mount via the `sp-ungroup-dropzone-in` keyframe on the shared `var(--sp-motion-base) var(--sp-ease-emphasized)` beat; the surrounding `.sp-drop-shift` reflow opens the slot it sits in.
- `@media (prefers-reduced-motion: reduce)` disables drag transitions (`.sp-drop-shift`, `.sp-drag-unfolding`, `.group-container.drag-into > .group-header`) and shows `.sp-ungroup-dropzone` instantly (`animation: none` — it still appears, just without the entry beat).

Implementation notes:

- Reflow logic lives in `src/content/content-drag-reflow.js` (`prepareDragSession`, `foldDraggedItems`, `computeReflow`, `applyReflow`, `clearReflow`, `unfoldDraggedItems`). `content-tree-interactions.js` calls these from dragstart / dragover / drop / dragend.
- Ghost cloning lives in `src/content/content-drag-multi.js` (`cloneSourceItem` / `inlineStylesRecursive`). `createMultiDragGhost({ count, sourceClones, root })` builds the single-vs-stack wrapper + badge from pre-cloned + style-inlined Elements.
- Insertion position is computed by `computeDropIntent` in `content-tree-interactions.js` as a pure pointer-Y → list → slot mapping against each element's *un-shifted layout top* (`rect.top - extractInlineTranslateY(el)`), so the active reflow shift on a sibling does not feed back into intent detection. The deepest group-container whose un-shifted children-area contains the pointer wins (via parent-map depth), then mid-Y of its direct children selects the slot. Never derive intent from `e.target.closest()` during a drag — the rendered (visual) layout includes transform shifts. **Ancestor caveat (nested subfolders):** `extractInlineTranslateY(el)` only strips an element's *own* inline transform, but a `.group-header` / `.group-children` carries none of its own while its `getBoundingClientRect` inherits its `.group-container`'s reflow `translateY` (a nested subfolder rides `+slotHeight` whenever a slot lands at/before it in its parent's children). So the header-band and children-band reads additionally subtract `extractInlineTranslateY(chosenContainer)` to stay in the same un-shifted frame as the container band — without it, a cursor past the header is mis-read as `into-group` for the frame the shift survives (the nested-subfolder drop twitch).
- Filtered slot mapping uses the last visible row as the insertion anchor rather than treating it as the end of the hidden underlying container. The pre-decision characterization found root source/group paths already returned index `3` for the example below, while group children returned `4`; an empty visible list over nonempty state guessed index `0`. `resolveVisibleAnchorInsertIndex` now applies one identity-safe rule to root, group children, single-source, multi-source, and group reorder paths, and returns no target when a nonempty container has no visible anchor. Same-container removal/index correction remains a later mutation-stage concern and is not part of the anchor resolver.

  ```text
  Decision: anchor-relative
  Example: [A, hidden-B, C, hidden-D], visible [A, C], after C -> index 3
  Applies to: root, group children, source, group, multi-source
  ```
- `.dragging`, `.sp-drag-folded`, `.sp-drag-unfolding`, `.sp-drop-shift`, `.drag-into`, `.drag-invalid`, `.drag-over-top`, `.drag-over-bottom`, `.sp-pseudo-hover`, `.sp-drag-active`, `.sp-drag-guide` styles all live in `contentStyleText` (Shadow DOM scope).
- `.sp-drag-ghost`, `.sp-drag-ghost-single`, `.sp-drag-ghost-stack`, `.sp-drag-ghost-layer`, `.sp-drag-ghost-badge` styles live in `globalOverlayStyleText` because the ghost element is appended to `document.body` for the native drag-image capture, and Shadow DOM tokens do not reach it. Resolved light/dark accent values are hardcoded with a `@media (prefers-color-scheme: dark)` override on the badge background. `.sp-drag-ghost-layer` is an inner wrapper around each cloned source-item — it carries the stack/single transform + drop-shadow so the clone's inline `cssText` (written by `inlineStylesRecursive` to resolve Shadow DOM tokens outside the shadow tree) doesn't override the positional transforms.

Rules:

- Do not reintroduce blue-bar insertion indicators (`.drag-over-top` / `.drag-over-bottom`) — the moving slot itself is the insertion indicator.
- Do not introduce a new ghost variant for other drag flows without a clear UX reason; reuse `.sp-drag-ghost`.
- Do not animate the ghost element itself (it lives ~200ms; transitions would conflict with the browser's drag-image capture).
- Do not add interactive elements to the ghost (it is `pointer-events: none` and `aria-hidden`).
- Keep fold, unfold, and reflow shift on the same `var(--sp-motion-base) var(--sp-ease-emphasized)` beat so the origin row's collapse / grow-back and the siblings' slide stay coordinated. (Fold was historically instant to avoid jitter; slot-based geometric detection removed that constraint, so the animated fold is now safe.)
- Keep the post-drop landing motion direction-neutral (opacity fade + sibling FLIP). Do not reintroduce a directional `.sp-drop-flying` cursor→slot fly-in, `.sp-drop-landing` scaleY-from-top, or `.sp-drop-landed` accent flash — they were removed because their built-in direction read as a confusing scatter.

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
- Related control clusters and dynamic regions carry landmark/grouping semantics: the quick-view rail is `role="group"` (`ui_quick_view_rail_label`), the batch action bar is `role="toolbar"` (`ui_batch_actions_region`), and the panel resizer is a focusable `role="separator"` (`aria-orientation="horizontal"`, `ui_panel_resizer_label`, `tabindex=0`) operable with ArrowUp/ArrowDown (steps height, clamped to the same per-view min as drag, persisted). The toggle buttons that flip state (batch mode, quick-view, isolate) expose `aria-pressed`.
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
4. ~~Consider replacing the inline folder emoji in group titles with a formal icon element for stricter consistency.~~ **Done** — group titles render a formal `sp-group-title-icon` (`google-symbols` "folder"), no emoji.
5. Keep popup and content-panel motion tokens aligned if either surface changes.

## 23. Canonical File Map

Use this map when updating UI. It lists UI / style / render / modal / toast modules only — pure state, persistence, message-routing, and logic modules live in `docs/PROJECT_DIRECTORY.md`.

- `src/content/content-style-text.js`: content-panel tokens, components, motion, overlays (Shadow-DOM `NSM_CONTENT_STYLE_TEXT` + global-overlay `NSM_GLOBAL_OVERLAY_STYLE_TEXT`)
- `src/content/styles.css`: native Gemini Notebook DOM overrides — injected via manifest `content_scripts[0].css`, scoped under `.sources-plus-manager-active`, uses `!important` to hide native source-list containers and restyle native Material menus (the third CSS mechanism; lives in the page, not the Shadow DOM)
- `src/content/content-template.js`: shell structure
- `src/content/content-panel-dom.js`: source panel lookup, renderability, lifecycle scheduling helpers
- `src/content/content-source-actions.js`: source action menu state, menu models, native menu bridge
- `src/content/content-source-action-menu.js`: source action menu item generation and failed-source menu variants
- `src/content/content-tags.js`: tag normalization, serialization, CRUD helpers
- `src/content/content-state-reconcile.js`: persisted source and tag reconciliation
- `src/content/content-persistence.js`: state load/save, schema normalization, lifecycle persistence
- `src/content/content-modals.js`: modal orchestration + shared modal helpers (prepareModalOpen / closeManagedModal, focus-trap glue, item stagger style, import-preview rendering, file/clipboard IO); delegates each modal's node-building to the `content-modal-*` sub-factories
- `src/content/content-modal-move.js`: move-to-folder modal — flattened group-tree picker, executes move of current/batch sources
- `src/content/content-modal-tag.js`: tag-management + batch-tag modals; reusable tag editor + tag color control (preset swatches + hex input)
- `src/content/content-modal-tag-filter.js`: quick-view "filter by tag" modal (single-select tag chips)
- `src/content/content-modal-command-palette.js`: command-palette modal (search, keyboard nav, in-place shortcut rebinding)
- `src/content/content-modal-settings.js`: settings modal + quick-view visibility sub-modal + developer settings panel
- `src/content/content-modal-welcome.js`: first-run welcome modal; exports the feature-row builder reused by What's New + Settings
- `src/content/content-modal-whats-new.js`: post-upgrade What's New modal (reuses welcome feature rows, marks version seen)
- `src/content/content-toast.js`: Shadow-DOM toast queue/renderer (showToast / showUndoableToast); distinct from `content-toast-status.js` below (text normalization only)
- `src/content/content-modal-focus.js`: modal focus trap, Escape handling, and focus restoration helpers
- `src/content/content-native-label-import-modal.js`: native label import preview modal node generation
- `src/content/content-render.js`: fragment patching, icons, menu layer, main render path
- `src/content/content-view-state.js`: search/filter/quick-view/isolation view-state helpers and effective-state sync
- `src/content/content-tree-interactions.js`: tree mutations, rename, batch interactions, drag-and-drop
- `src/content/content-drag-reflow.js`: drag reflow / fold / drop-shift visual transition engine (`prepareDragSession` / `foldDraggedItems` / `computeReflow` / `applyReflow` / `clearReflow` / `unfoldDraggedItems`; `DEFAULT_TRANSITION_MS = 180`, aligned to `--sp-motion-base`)
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
