# Release Checklist

Use this checklist before publishing a new Chrome Web Store build.

1. Update the version in `manifest.json` and `package.json`; if `package-lock.json` exists, keep its package version in sync.
2. Update the README version badge to the same version.
3. Move the relevant `CHANGELOG.md` `Unreleased` entries into `## [YYYY-MM-DD] [x.y.z]` using the actual local release date.
4. Run `npm run test:unit`.
5. Run `npm run test:smoke` (headless by default; use `PLAYWRIGHT_HEADLESS=false npm run test:smoke` only for interactive debugging).
6. Run `git diff --check`.
7. Run `npm run package`.
8. Confirm the zip is named `notebooklm-source-management-<version>.zip`.
9. Confirm the zip contains only extension runtime files:
   - `manifest.json`
   - `src/**`
   - `_locales/**`
   - `PRIVACY.md` when present
10. Load the unpacked extension in Chrome and run a quick manual pass:
   - popup launcher opens the in-page manager
   - source panel injects correctly
   - settings import/export opens
   - folders, search, tags, batch actions, and Undo still work
