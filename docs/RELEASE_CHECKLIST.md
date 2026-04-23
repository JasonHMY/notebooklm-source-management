# Release Checklist

Use this checklist before publishing a new Chrome Web Store build.

1. Update the version in `manifest.json` and `package.json`.
2. Run `npm run test:unit`.
3. Run `npm run test:smoke`.
4. Run `git diff --check`.
5. Run `npm run package`.
6. Confirm the zip is named `notebooklm-source-management-<version>.zip`.
7. Confirm the zip contains only extension runtime files:
   - `manifest.json`
   - `src/**`
   - `_locales/**`
   - `PRIVACY.md` when present
8. Load the unpacked extension in Chrome and run a quick manual pass:
   - popup launcher opens the in-page manager
   - source panel injects correctly
   - settings import/export opens
   - folders, search, tags, batch actions, and Undo still work
