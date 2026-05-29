# NotebookLM Source Management

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-26.5.29-green.svg)

A Chrome extension that makes source management inside Google NotebookLM less awkward.

It runs directly inside NotebookLM's source panel. The toolbar icon is only a launcher that helps you jump back to the in-page manager; it is not a separate popup app.

## What It Does

- Group sources into custom folders.
- Create nested folders, move sources into subfolders, and isolate one folder when you want to focus.
- Reorder sources or whole groups with drag and drop.
- Search by source title, tag, or folder, with simple `tag:` and `folder:` filters.
- Automatically expand folders that contain search results, then restore the previous collapsed state when search is cleared.
- Add color-coded tags, filter by tag, and batch add or remove tags.
- Move sources into folders one at a time or in batches, including moving selected sources back to ungrouped.
- Delete multiple sources at once through NotebookLM's native delete confirmation flow.
- Open source details, rename sources, and delete sources from a single plugin menu.
- Undo recent plugin-side organization changes with `Command+Z` on macOS or `Ctrl+Z` on Windows/Linux.
- Show a one-time welcome panel with a feedback shortcut the first time the in-page manager loads.
- Show a one-time What's New panel for larger feature updates.
- Export and import a notebook's organization config from the settings panel.
- Configure local version-history retention and create named restore points before risky changes.
- Open the Chrome Web Store feedback page from settings, with an optional diagnostics copy step for bug reports.
- Turn the in-page manager on or off from the toolbar popup without deleting saved data.
- Switch manually between Auto, English, Spanish, and Simplified Chinese.
- Use local icon font assets instead of depending on remote Google Symbols font loading.

If one of your notebooks has started to fill up with PDFs, links, and uploads, this extension is meant to make that list easier to work with.

## Installation

1. Clone or download this repository.
2. Open Chrome and go to `chrome://extensions/`.
3. Turn on `Developer mode`.
4. Click `Load unpacked` and choose the repository root.
5. If you want quicker access, pin the extension to the toolbar.

After installation:

- If you are already inside a NotebookLM notebook, clicking the toolbar icon will try to bring you straight to the in-page source manager.
- If you are not inside a notebook yet, it will open NotebookLM first so you can choose one.

NotebookLM is a single-page app, so switching notebooks does not always trigger a full reload. This extension tries to tear down and rebuild itself in place. A full page refresh is only used as a fallback when the source panel cannot be reattached after repeated retries.

## Automated Checks

Use these commands when you want to verify the repository without doing a full manual smoke pass:

- For a maintainer-oriented map of directories, feature areas, storage keys, and test entrypoints, see [docs/PROJECT_DIRECTORY.md](docs/PROJECT_DIRECTORY.md).
- `npm run lint` runs ESLint over `src/`, `tests/`, `scripts/`, and `eslint.config.js` using the flat config that pins per-area globals (NSM_* factories, Chrome MV3, Jest, Node) and blocks `innerHTML` writes.
- `npm run test:unit` runs the Jest unit suite.
- `npm run test:smoke` runs the Playwright browser smoke suite headlessly by default, so it should not open visible browser windows during normal development.
- `PLAYWRIGHT_HEADLESS=false npm run test:smoke` runs the smoke suite with visible browser windows when you need to debug an interaction.
- `npm run verify:full` runs lint, unit, and smoke suites in sequence — the same gate the GitHub Actions CI workflow enforces.
- `npm run playwright:install` installs the Chromium browser used by Playwright smoke.
- `npm run package` creates the Chrome Web Store zip and validates its contents.

The Playwright smoke suite covers the core extension surfaces and the higher-risk NotebookLM DOM regressions, including:

- extension popup shell startup and manager injection into a NotebookLM-style fixture
- content/background/popup message bridge paths such as `GET_MANAGER_STATUS`, `FOCUS_MANAGER`, and source-view switching
- developer-mode log sanitization and disabled-mode behavior
- label/list view state sync, collapsed native label import, and fallback source-view behavior
- route reattachment, hard reload recovery, import backup restore, hostile metadata rendering, blocked third-party icons, and stale-save rejection

## Permissions

- `storage`: saves folder membership, ordering, per-source enabled state, and custom panel height for each notebook.
- `tabs`: lets the launcher find, focus, or open the correct NotebookLM tab instead of guessing.

## Privacy

This extension does not send NotebookLM content to external servers. State stays in the browser, and this release does not include analytics, telemetry, or crash reporting.

Import/export config files are generated locally in your browser. They contain this extension's saved folder order, tags, enabled state, and related per-notebook organization data.

The settings panel can open the Chrome Web Store feedback page. Diagnostics are not sent automatically; if you copy and paste them into a review or support comment, that submission is handled by Chrome Web Store.

See [PRIVACY.md](PRIVACY.md) for the full privacy note.

## Troubleshooting

- **The manager disappears after you switch notebooks.** Give the page a moment to finish the in-place rebuild. If it still does not come back, refresh once and try again.
- **Batch actions are disabled.** Make sure the source list has finished loading. Controls stay disabled while NotebookLM is still rendering placeholders.
- **The popup still says a refresh is needed, or it cannot find the source panel.** Refresh the page, then open the launcher again so the extension can rebuild its state.
- **A source loses its saved enabled state.** The extension prefers stable DOM identifiers when it can find them. If NotebookLM does not expose one, it falls back to a normalized fingerprint based on `title + aria-label + icon`. That works most of the time, but duplicate or unnamed sources can still be matched imperfectly after a major UI change.
- **Import preview reports unmatched sources.** The imported folders and tags can still be applied, but unmatched sources cannot inherit source-specific state until NotebookLM exposes matching source identities in the current notebook.
- **Undo does not restore a NotebookLM-deleted source.** Undo covers plugin-side organization changes. Native NotebookLM deletion still removes the real source through NotebookLM's own confirmation flow.

## Development Smoke Checklist

Use this checklist after changes to the content script, popup launcher, or source list rendering.

1. Load the repository from `chrome://extensions` with `Developer mode` enabled.
2. Open an existing NotebookLM notebook and confirm the in-page manager mounts under the source panel.
3. Verify source rows still show the correct icon:
   - regular source icons render normally
   - the native more-options button icon is not reused as the source icon
   - at least one source that uses a background or mask-based icon still renders correctly
4. Open the toolbar popup in three contexts and confirm the primary CTA is correct:
   - inside a notebook
   - on the NotebookLM home page
   - on a non-NotebookLM page
5. Switch between notebooks without closing the tab and confirm the manager reattaches.
6. Walk through the core interactions once:
   - create a group
   - rename a group
   - drag a source or group
   - enter batch mode
   - open the batch delete flow
   - confirm untitled sources or groups show localized fallback text
   - enter batch mode, select 3 sources, drag one of them into a folder, verify all three move
   - in single-source mode, drag any source toward the bottom edge of the list and verify the list auto-scrolls
   - drag near the top edge and verify reverse auto-scroll
   - drag a source over a collapsed folder header for 1 second and verify the folder expands automatically
   - drag a source onto itself and verify the drop indicator turns red with a `not-allowed` cursor
   - drag a parent group onto one of its child subgroups and verify the red indicator + `not-allowed` cursor
   - hover-open a folder during drag, then drag away from it for 1 second; verify it auto-collapses with the same animation as a chevron click

## License

MIT
