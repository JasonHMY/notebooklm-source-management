# Security Threat Model

## Overview

This repository is a Manifest V3 Chrome extension that augments Google NotebookLM source management. It injects content scripts on `https://notebooklm.google.com/*`, builds a shadow-DOM manager UI, scans NotebookLM's source panel, stores per-notebook grouping and tagging state in `chrome.storage.local`, and uses a service-worker background script for privileged storage and tab operations. There is no backend service, database, authentication system, or server-side request path.

Primary assets are the user's NotebookLM source organization, source titles and metadata stored locally, tags, the ability to automate NotebookLM UI actions such as source enable/disable, rename, details, and deletion, and the extension package integrity. The extension does not intentionally store full source document content. Export/config JSON contains organization metadata and source titles/identifiers. Diagnostics intentionally omit source titles/content.

The main security context is a browser extension running on a sensitive first-party Google site. Classic web-app issues such as SQL injection, CSRF, SSRF, server auth bypass, and multi-tenant backend isolation are mostly out of scope. The important classes are DOM injection/XSS in extension-created UI, unsafe handling of user-selected JSON imports, message authorization, local storage integrity, privacy leakage of source metadata, and correctness of automated clicks against a changing NotebookLM DOM.

## Trust Boundaries And Assumptions

Attacker-controlled inputs include source titles, labels, icon URLs, attributes, and other DOM text/metadata exposed by NotebookLM rows; DOM mutations from NotebookLM; user-selected import JSON files or pasted import text; drag/drop and click targets inside the extension UI; and values loaded from extension storage if the local browser profile or extension storage is already compromised. A compromised NotebookLM page can influence the DOM observed by content scripts.

Operator-controlled inputs include popup actions, settings import/export, copy/download, extension enable/disable, source view switching, deletion/rename actions, and Chrome install/update choices. These usually require user interaction and should be severity-calibrated accordingly.

Developer-controlled inputs include manifest permissions, locales, bundled CSS/assets, test fixtures, build scripts, npm dependencies, and CI. These affect supply-chain risk but are not runtime attacker input in the published extension.

Key trust boundaries:

- Web page DOM to extension content script: untrusted. Content scripts read NotebookLM DOM and create a separate manager UI.
- Content script/popup to background service worker: privileged boundary. Background can use `tabs` and `storage` permissions.
- Content script direct storage access: content scripts also have `chrome.storage.local` access. Background sender validation is not the only state-write boundary; code must keep normal writes routed through background and reserve direct writes for explicit fallback/test paths.
- User import file to persistent extension state: untrusted but user-assisted.
- Extension storage/sessionStorage to runtime state: trusted for normal operation but must be robust against corruption and stale writes.
- Browser extension to NotebookLM native UI: automation boundary. The extension clicks native controls on the user's behalf.

Assumptions: normal web pages cannot directly call this extension's internal `chrome.runtime` listeners; NotebookLM page JavaScript cannot access extension APIs from the page world. Other extensions are generally outside the threat model unless Chrome's extension isolation is broken. Local malware or a user with filesystem/profile access can read or alter extension data and is out of scope except for robustness.

## Attack Surface And Mitigations

Manifest and permissions: `manifest.json` requests only `storage` and `tabs`, matches HTTPS NotebookLM, and exposes only bundled fonts as web-accessible resources. No remote code or broad host permissions are present. The `tabs` permission is still sensitive because popup/background can inspect and focus NotebookLM tabs.

Background messages and storage: `src/background/index.js` handles state save/load/history messages, enforces NotebookLM notebook senders, validates storage key prefixes, queues writes per key, applies revision guards, preserves backups/history, trims history for quota pressure, and returns explicit error codes. Non-state messages primarily open/focus NotebookLM or update an extension-enabled boolean.

Content rendering and DOM injection: source titles, group names, tag labels, imported labels, diagnostics text, and preview details are rendered through the shared `el()` helper. String children become text nodes, event-handler attributes are blocked, and `javascript:` values in sensitive URL attributes are rejected. Production code should not introduce `innerHTML`, `eval`, or dynamic `Function` for untrusted values.

Source icon privacy: icon URLs copied from NotebookLM DOM/CSS can cause browser-side requests. This is not SSRF because the extension has no server-side request path, but it can leak user IP, timing, and target URL to third parties. Runtime icon extraction must allow only NotebookLM/Google-owned static/content origins, current-extension URLs, safe small raster data URLs, and NotebookLM-origin blob URLs; all other URL candidates must fall back to local glyph icons.

User import/export: settings import accepts pasted or user-selected JSON. Controls include size limits, maximum counts for groups/tags/sources/children/depth, cycle detection, source remapping preview, tag ID sanitization, import backup, and state history. Malicious import is primarily a user-assisted integrity/availability risk rather than a remote compromise path.

NotebookLM DOM scanning and reconciliation: source identity is extracted from untrusted DOM and matched using stable tokens/fingerprints. Stable tokens reduce accidental cross-source actions but remain heuristic. A maliciously changed NotebookLM DOM could make the extension misidentify rows if checks are weakened.

Native UI automation: source details, rename, and deletion actions click NotebookLM controls on the user's behalf. Destructive actions must re-resolve and validate the fresh native source row before clicking, only act on newly opened native menus/dialogs, and fail closed on row mismatch, ambiguous delete confirmations, or dialogs that clearly reference a different source.

Privacy and diagnostics: diagnostics deliberately omit source titles/content. Export, storage, recovery, and history include organization metadata and titles, so users should treat exported JSON and local extension storage as private.

Packaging: release packaging allowlists manifest, source, locale, and privacy entries, and forbids `node_modules`, tests, `.git`, output, and release directories.

## Criticality Calibration

Critical: unauthenticated remote code execution in the extension context; remote attacker exfiltrates all stored NotebookLM metadata or exported configs without user action; external message path overwrites/deletes arbitrary notebook state; remote/no-click trigger of NotebookLM destructive actions across sources; supply-chain flaw packages secrets or unreviewed executable code into the release.

High: stored/reflected DOM XSS from source titles, tags, labels, or imports that can call extension APIs or automate NotebookLM; bypass of background sender/key validation for state writes; reliable wrong-source or mass deletion/rename after normal user interaction; import parser bypass that persistently corrupts a notebook or exhausts storage despite configured limits; unintended network leak of private source titles/export data.

Medium: user-assisted malicious import causing local UI denial of service or recoverable state corruption; stale revision/race bugs losing recent organization changes; DOM-matching confusion that opens or toggles the wrong source without deletion; diagnostics accidentally exposing source titles to clipboard on user action; overly broad tab handling exposing non-content metadata.

Low: UI spoofing, toast/message confusion, recoverable storage/history inconsistencies, popup open/focus bugs, non-sensitive denial of service in a single tab, test-only exported internals, and developer-only scripts that are not packaged.
