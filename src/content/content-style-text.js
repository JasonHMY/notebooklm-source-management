(function () {
    'use strict';

    function getExtensionAssetUrl(path) {
        try {
            const chromeApi = globalThis.chrome;
            if (chromeApi?.runtime && typeof chromeApi.runtime.getURL === 'function') {
                return chromeApi.runtime.getURL(path);
            }
        } catch (error) {
            // Fall through to the relative path for tests and degraded environments.
        }
        return path;
    }

    const googleSymbolsFontUrl = getExtensionAssetUrl('src/assets/fonts/google-symbols.woff2');

    const contentStyleText = `
            @font-face {
                font-family: 'Google Symbols';
                font-style: normal;
                font-weight: 400;
                src: url("${googleSymbolsFontUrl}") format('woff2');
            }
            .google-symbols {
                font-family: 'Google Symbols';
                font-weight: normal;
                font-style: normal;
                font-size: 18px;
                line-height: 1;
                letter-spacing: normal;
                text-transform: none;
                display: inline-block;
                white-space: nowrap;
                word-wrap: normal;
                direction: ltr;
                -webkit-font-feature-settings: 'liga';
                -webkit-font-smoothing: antialiased;
            }
            
            /* -------- Light Mode (Default) -------- */
            :host {
                --sp-bg-primary: transparent;
                --sp-bg-secondary: rgba(0,0,0,0.03);
                --sp-bg-hover: rgba(0,0,0,0.04);
                --sp-bg-button: #fff;
                --sp-bg-button-hover: #f5f5f7;
                --sp-bg-button-active: #ebebeb;
                --sp-bg-toast: rgba(0,0,0,0.8);
                --sp-bg-badge: rgba(0,0,0,0.05);
                --sp-bg-switch: #e9e9ea;
                --sp-bg-switch-thumb: white;
                --sp-bg-checkbox: #fff;
                --sp-border-light: rgba(0,0,0,0.1);
                --sp-border-medium: rgba(0,0,0,0.15);
                --sp-border-checkbox: rgba(0,0,0,0.25);
                --sp-text-primary: #1A1A1C;
                --sp-text-secondary: #6E6E73;
                --sp-text-tertiary: #8e8e93;
                --sp-text-toast: #fff;
                --sp-text-badge: #6E6E73;
                --sp-accent: #007aff;
                --sp-accent-danger: #ff3b30;
                --sp-accent-success: #34c759;
                --sp-drag-bg: rgba(0, 122, 255, 0.05);
                --sp-drag-into-bg: rgba(0, 122, 255, 0.1);
                --sp-focus-ring: 0 0 0 3px rgba(0, 122, 255, 0.15);
                --sp-focus-ring-soft: 0 0 0 3px rgba(0, 122, 255, 0.12);
                --sp-focus-ring-strong: 0 0 0 3px rgba(0, 122, 255, 0.22), 0 18px 40px rgba(0, 122, 255, 0.18);
                --sp-search-focus-border: rgba(0, 122, 255, 0.7);
                --sp-search-focus-ring:
                    inset 0 1px 0 rgba(255,255,255,0.32),
                    0 0 0 1px rgba(0, 122, 255, 0.34),
                    0 0 0 3px rgba(0, 122, 255, 0.14),
                    0 10px 24px rgba(0, 122, 255, 0.12);
                --sp-shadow-toast: 0 8px 32px rgba(0,0,0,0.08);
                --sp-shadow-button: 0 8px 32px rgba(0,0,0,0.08);
                --sp-shadow-hover-item: 0 10px 24px rgba(0,0,0,0.08);
                --sp-panel-bg: #f6f7f9;
                --sp-shadow-switch-thumb: 0 1px 2px rgba(0,0,0,0.2), 0 0 1px rgba(0,0,0,0.1);
                --sp-icon-button-hover: rgba(0,0,0,0.08);
                --sp-tag-active-bg: rgba(0, 122, 255, 0.12);
                --sp-tag-active-border: rgba(0, 122, 255, 0.3);
                --sp-tag-active-text: var(--sp-accent);
                --sp-isolate-active-bg: rgba(0, 122, 255, 0.12);
                --sp-delete-hover-bg: rgba(255, 59, 48, 0.1);
                --sp-overlay-backdrop: rgba(0, 0, 0, 0.2);
                --sp-modal-bg: rgba(255, 255, 255, 0.85);
                --sp-modal-border: rgba(0, 0, 0, 0.05);
                --sp-modal-divider: rgba(0, 0, 0, 0.05);
                --sp-modal-shadow: 0 24px 48px rgba(0, 0, 0, 0.12), 0 0 1px rgba(0,0,0,0.1);
                --sp-tag-swatch-inset: inset 0 0 0 1px rgba(0, 0, 0, 0.06);
                --sp-tag-color-trigger-border: rgba(0, 0, 0, 0.08);
                --sp-batch-selected-bg: rgba(0, 122, 255, 0.05);
                --sp-batch-checkbox-bg: rgba(0, 122, 255, 0.1);
                --sp-spotlight-color: rgba(0, 122, 255, 0.14);
                --sp-glare-color: rgba(255, 255, 255, 0.42);
                --sp-batch-glow: rgba(0, 122, 255, 0.16);
                --sp-danger-glow: rgba(255, 59, 48, 0.22);
                --sp-empty-state-bg: rgba(0, 0, 0, 0.01);
                --sp-scrollbar-thumb: rgba(150, 150, 150, 0.3);
                --sp-scrollbar-thumb-hover: rgba(150, 150, 150, 0.6);
                --sp-menu-item-hover-bg: rgba(128, 128, 128, 0.1);
                --sp-motion-fast: 120ms;
                --sp-motion-base: 180ms;
                --sp-motion-medium: 240ms;
                --sp-motion-slow: 320ms;
                --sp-ease-standard: cubic-bezier(0.2, 0.8, 0.2, 1);
                --sp-ease-emphasized: cubic-bezier(0.2, 0.9, 0.25, 1);
                --sp-ease-press: cubic-bezier(0.25, 1, 0.5, 1);
                
                /* Global Glassmorphism Variables */
                --sp-glass-bg-body: rgba(255, 255, 255, 0.85);
                --sp-glass-bg-menu: rgba(255, 255, 255, 0.85);
                --sp-glass-border: rgba(0, 0, 0, 0.05);
                --sp-glass-shadow: 0 8px 32px rgba(0, 0, 0, 0.08);
            }

            /* -------- Dark Mode Override -------- */
            @media (prefers-color-scheme: dark) {
                :host {
                    --sp-bg-secondary: rgba(255,255,255,0.05);
                    --sp-bg-hover: rgba(255,255,255,0.08);
                    --sp-bg-button: #1c1c1e;
                    --sp-bg-button-hover: #2c2c2e;
                    --sp-bg-button-active: #3a3a3c;
                    --sp-bg-toast: rgba(255,255,255,0.9);
                    --sp-bg-badge: rgba(255,255,255,0.1);
                    --sp-bg-switch: #39393d;
                    --sp-bg-switch-thumb: white;
                    --sp-bg-checkbox: rgba(255,255,255,0.1);
                    --sp-border-light: rgba(255,255,255,0.1);
                    --sp-border-medium: rgba(255,255,255,0.2);
                    --sp-border-checkbox: rgba(255,255,255,0.6);
                    --sp-text-primary: #f5f5f7;
                    --sp-text-secondary: #98989d;
                    --sp-text-tertiary: #b0b0b5;
                    --sp-text-toast: #000;
                    --sp-text-badge: #98989d;
                    --sp-accent: #0a84ff;
                    --sp-accent-danger: #ff453a;
                    --sp-accent-success: #30d158;
                    --sp-drag-bg: rgba(10, 132, 255, 0.1);
                    --sp-drag-into-bg: rgba(10, 132, 255, 0.15);
                    --sp-focus-ring: 0 0 0 3px rgba(10, 132, 255, 0.15);
                    --sp-focus-ring-soft: 0 0 0 3px rgba(10, 132, 255, 0.12);
                    --sp-focus-ring-strong: 0 0 0 3px rgba(10, 132, 255, 0.22), 0 18px 40px rgba(10, 132, 255, 0.18);
                    --sp-search-focus-border: rgba(64, 156, 255, 0.78);
                    --sp-search-focus-ring:
                        inset 0 1px 0 rgba(255,255,255,0.06),
                        0 0 0 1px rgba(64, 156, 255, 0.46),
                        0 0 0 3px rgba(64, 156, 255, 0.18),
                        0 10px 24px rgba(10, 132, 255, 0.16);
                    --sp-shadow-toast: 0 8px 32px rgba(0,0,0,0.4);
                    --sp-shadow-button: 0 8px 32px rgba(0,0,0,0.2);
                    --sp-shadow-hover-item: 0 12px 28px rgba(0,0,0,0.32);
                    --sp-panel-bg: #272c33;
                    --sp-shadow-switch-thumb: 0 1px 2px rgba(0,0,0,0.3), 0 0 1px rgba(0,0,0,0.2);
                    --sp-icon-button-hover: rgba(255,255,255,0.15);
                    --sp-tag-active-bg: rgba(10, 132, 255, 0.16);
                    --sp-tag-active-border: rgba(10, 132, 255, 0.34);
                    --sp-tag-active-text: var(--sp-accent);
                    --sp-isolate-active-bg: rgba(10, 132, 255, 0.16);
                    --sp-delete-hover-bg: rgba(255, 69, 58, 0.16);
                    --sp-overlay-backdrop: rgba(0, 0, 0, 0.6);
                    --sp-modal-bg: rgba(30, 30, 32, 0.85);
                    --sp-modal-border: rgba(255,255,255,0.1);
                    --sp-modal-divider: rgba(255,255,255,0.05);
                    --sp-modal-shadow: 0 24px 48px rgba(0, 0, 0, 0.4), 0 0 1px rgba(255,255,255,0.1);
                    --sp-tag-swatch-inset: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
                    --sp-tag-color-trigger-border: rgba(255, 255, 255, 0.14);
                    --sp-batch-selected-bg: rgba(10, 132, 255, 0.12);
                    --sp-batch-checkbox-bg: rgba(10, 132, 255, 0.18);
                    --sp-spotlight-color: rgba(64, 156, 255, 0.18);
                    --sp-glare-color: rgba(255, 255, 255, 0.24);
                    --sp-batch-glow: rgba(10, 132, 255, 0.24);
                    --sp-danger-glow: rgba(255, 69, 58, 0.28);
                    --sp-empty-state-bg: rgba(255, 255, 255, 0.01);
                    --sp-scrollbar-thumb: rgba(150, 150, 150, 0.3);
                    --sp-scrollbar-thumb-hover: rgba(150, 150, 150, 0.6);
                    --sp-menu-item-hover-bg: rgba(128, 128, 128, 0.16);
                    
                    /* Global Glassmorphism Variables */
                    --sp-glass-bg-body: rgba(28, 28, 30, 0.85);
                    --sp-glass-bg-menu: rgba(44, 44, 46, 0.85);
                    --sp-glass-border: rgba(255, 255, 255, 0.15);
                    --sp-glass-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
                }
            }

            .sp-container {
                display: flex;
                flex-direction: column;
                max-height: calc(100vh - 220px);
                min-height: 150px;
                font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                color: var(--sp-text-primary);
                position: relative;
                background: var(--sp-panel-bg);
                transition:
                    box-shadow var(--sp-motion-slow) var(--sp-ease-standard),
                    transform var(--sp-motion-slow) var(--sp-ease-standard);
            }
            .sp-container.sp-focus-ring {
                box-shadow: var(--sp-focus-ring-strong);
                transform: translateY(-2px);
            }
            .sp-container.is-native-label-view {
                min-height: 0;
                max-height: none;
                background: transparent;
            }
            .sp-container.is-native-label-view .sp-controls {
                padding-bottom: 4px;
            }
            .sp-container.is-native-label-view .sp-toolbar-actions > button:not(.sp-toolbar-settings),
            .sp-container.is-native-label-view .sp-search-cluster,
            .sp-container.is-native-label-view .sp-quick-view-rail,
            .sp-container.is-native-label-view #sources-list {
                display: none;
            }
            .sp-container.is-native-label-view .sp-view-state {
                padding: 4px 0 8px;
            }
            .sp-container.is-native-label-view .sp-view-banner {
                background: var(--sp-panel-bg);
            }
            .sp-container.is-native-label-view .sp-resizer {
                display: flex;
            }
            .sp-resizer {
                height: 8px;
                width: 100%;
                cursor: ns-resize;
                position: absolute;
                bottom: -4px;
                left: 0;
                z-index: 10;
                display: flex;
                justify-content: center;
                align-items: center;
            }
            .sp-resizer::after {
                content: '';
                width: 30px;
                height: 3px;
                background-color: var(--sp-border-medium);
                border-radius: 3px;
                transition: background-color var(--sp-motion-base) var(--sp-ease-standard);
            }
            .sp-resizer:hover::after {
                background-color: var(--sp-accent);
            }
            
            /* Sticky Header */
            .sp-controls {
                display: flex;
                align-items: center;
                gap: 8px;
                flex-wrap: nowrap;
                min-width: 0;
                flex-shrink: 0;
                padding: 10px 0 8px;
                position: sticky;
                top: 0;
                z-index: 20;
                background: var(--sp-panel-bg);
                border-bottom: 1px solid var(--sp-border-light);
                transition: border-color var(--sp-motion-base) var(--sp-ease-standard);
            }
            .sp-controls::after {
                content: none;
                pointer-events: none;
            }
            .sp-toolbar-actions {
                display: flex;
                align-items: center;
                gap: 8px;
                flex: 0 1 auto;
                min-width: 0;
                max-width: 540px;
                overflow: hidden;
                transform-origin: right center;
                transition:
                    max-width var(--sp-motion-slow) var(--sp-ease-emphasized),
                    opacity var(--sp-motion-medium) var(--sp-ease-standard),
                    transform var(--sp-motion-slow) var(--sp-ease-emphasized);
            }
            .sp-controls > .sp-button,
            .sp-toolbar-actions > button {
                flex-shrink: 0;
            }
            .sp-toolbar-settings.sp-icon-button {
                width: 32px;
                height: 32px;
                border-radius: 999px;
                border: 1px solid var(--sp-border-light);
                background: var(--sp-bg-button);
                box-shadow: 0 6px 18px rgba(0,0,0,0.08);
                color: var(--sp-text-secondary);
            }
            .sp-button.sp-toolbar-action {
                border-radius: 999px;
                padding: 6px 12px;
                font-size: 12px;
                line-height: 1.2;
                box-shadow: 0 6px 18px rgba(0,0,0,0.08);
                transition:
                    opacity var(--sp-motion-medium) var(--sp-ease-standard),
                    transform var(--sp-motion-slow) var(--sp-ease-emphasized),
                    background-color var(--sp-motion-base) var(--sp-ease-standard),
                    border-color var(--sp-motion-base) var(--sp-ease-standard),
                    box-shadow var(--sp-motion-base) var(--sp-ease-standard);
            }
            .sp-controls.is-search-expanded .sp-toolbar-actions {
                flex-basis: 0;
                max-width: 0;
                opacity: 0;
                transform: translateX(12px) scale(0.96);
                pointer-events: none;
            }
            .sp-controls.is-search-expanded .sp-toolbar-actions > button {
                opacity: 0;
                transform: translateX(10px) scale(0.94);
            }
            .sp-toolbar-actions > button:nth-child(1) {
                transition-delay: 0s;
            }
            .sp-toolbar-actions > button:nth-child(2) {
                transition-delay: 0.03s;
            }
            .sp-toolbar-actions > button:nth-child(3) {
                transition-delay: 0.06s;
            }
            .sp-toolbar-actions > button:nth-child(4) {
                transition-delay: 0.09s;
            }
            .sp-toolbar-actions > button:nth-child(5) {
                transition-delay: 0.12s;
            }
            .sp-save-status {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                min-width: 0;
                max-width: 220px;
                padding: 5px 8px;
                border-radius: 999px;
                border: 1px solid var(--sp-border-light);
                background: var(--sp-bg-secondary);
                color: var(--sp-text-secondary);
                font-size: 11px;
                font-weight: 600;
                line-height: 1.2;
                white-space: nowrap;
                box-shadow: 0 6px 18px rgba(0,0,0,0.06);
                transition:
                    opacity var(--sp-motion-base) var(--sp-ease-standard),
                    transform var(--sp-motion-base) var(--sp-ease-standard),
                    background-color var(--sp-motion-base) var(--sp-ease-standard),
                    border-color var(--sp-motion-base) var(--sp-ease-standard),
                    color var(--sp-motion-base) var(--sp-ease-standard),
                    box-shadow var(--sp-motion-base) var(--sp-ease-standard);
            }
            .sp-save-status[hidden] {
                display: none;
            }
            .sp-save-status-label {
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .sp-save-status-saving {
                color: var(--sp-accent);
                border-color: rgba(0, 122, 255, 0.24);
            }
            .sp-save-status-saved {
                color: var(--sp-accent);
            }
            .sp-save-status-failed,
            .sp-save-status-stale,
            .sp-save-status-recovery_available {
                color: var(--sp-accent-danger);
                border-color: rgba(255, 59, 48, 0.28);
                box-shadow: 0 8px 22px rgba(255, 59, 48, 0.12);
            }
            .sp-save-status-action {
                border: 0;
                border-radius: 999px;
                background: rgba(0, 122, 255, 0.12);
                color: var(--sp-accent);
                font: inherit;
                padding: 2px 6px;
                cursor: pointer;
            }
            .sp-save-status-action-muted {
                background: transparent;
                color: var(--sp-text-secondary);
            }
            .sp-search-cluster {
                margin-left: auto;
                min-width: 0;
                display: flex;
                align-items: center;
                justify-content: flex-end;
                position: relative;
                isolation: isolate;
                flex: 0 0 auto;
                transition: flex-basis var(--sp-motion-slow) var(--sp-ease-emphasized);
            }
            .sp-controls.is-search-expanded .sp-search-cluster {
                flex: 1 1 auto;
            }
            .sp-search-trigger.sp-icon-button,
            .sp-search-close.sp-icon-button {
                width: 34px;
                height: 34px;
                border-radius: 999px;
                border: 1px solid var(--sp-border-light);
                background: var(--sp-bg-button);
                box-shadow: 0 6px 18px rgba(0,0,0,0.08);
                color: var(--sp-text-primary);
                position: relative;
                z-index: 2;
                padding: 0;
            }
            .sp-search-trigger.sp-icon-button .google-symbols,
            .sp-search-close.sp-icon-button .google-symbols {
                font-size: 18px;
            }
            .sp-search-close.sp-icon-button {
                width: 0;
                min-width: 0;
                padding: 0;
                margin-left: 0;
                opacity: 0;
                overflow: hidden;
                pointer-events: none;
                transform: translateX(-14px) scale(0.72);
                transition: width var(--sp-motion-slow) var(--sp-ease-emphasized),
                    margin-left var(--sp-motion-slow) var(--sp-ease-emphasized),
                    opacity var(--sp-motion-base) var(--sp-ease-standard),
                    transform var(--sp-motion-slow) var(--sp-ease-emphasized),
                    background-color var(--sp-motion-base) var(--sp-ease-standard),
                    border-color var(--sp-motion-base) var(--sp-ease-standard),
                    box-shadow var(--sp-motion-base) var(--sp-ease-standard);
            }
            .sp-search-close.is-visible {
                width: 34px;
                min-width: 34px;
                margin-left: 8px;
                opacity: 1;
                pointer-events: auto;
                transform: translateX(0) scale(1);
            }
            .sp-view-state {
                display: flex;
                flex-direction: column;
                gap: 8px;
                padding: 8px 0 4px;
            }
            .sp-view-state[hidden] {
                display: none;
            }
            .sp-quick-view-rail {
                display: flex;
                align-items: center;
                gap: 6px;
                min-width: 0;
                min-height: 44px;
                overflow-x: auto;
                padding: 8px 8px 6px;
                scroll-padding-inline: 8px;
                scrollbar-width: none;
            }
            .sp-quick-view-rail[hidden] {
                display: none;
            }
            .sp-quick-view-rail::-webkit-scrollbar {
                display: none;
            }
            .sp-quick-view-btn {
                appearance: none;
                -webkit-appearance: none;
                box-sizing: border-box;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                flex: 0 0 auto;
                height: 30px;
                min-height: 30px;
                margin: 0;
                border: 1px solid var(--sp-border-light);
                border-radius: 999px;
                padding: 0 12px;
                background: var(--sp-bg-button);
                color: var(--sp-text-secondary);
                font-size: 11px;
                font-weight: 700;
                line-height: 1.2;
                cursor: pointer;
                white-space: nowrap;
                transition:
                    background-color var(--sp-motion-base) var(--sp-ease-standard),
                    border-color var(--sp-motion-base) var(--sp-ease-standard),
                    color var(--sp-motion-base) var(--sp-ease-standard),
                    box-shadow var(--sp-motion-base) var(--sp-ease-standard);
            }
            .sp-quick-view-btn:hover,
            .sp-quick-view-btn:focus-visible,
            .sp-quick-view-btn.is-active {
                color: var(--sp-accent);
                border-color: var(--sp-search-focus-border);
                background: var(--sp-tag-active-bg);
            }
            .sp-quick-view-btn:focus-visible {
                outline: none;
                box-shadow: var(--sp-search-focus-ring);
            }
            .sp-view-banner {
                display: grid;
                grid-template-columns: minmax(0, 1fr) auto;
                align-items: center;
                gap: 12px;
                padding: 10px 12px;
                border-radius: 14px;
                background: var(--sp-bg-secondary);
                border: 1px solid var(--sp-border-light);
            }
            .sp-view-banner-copy {
                min-width: 0;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .sp-native-label-view-banner {
                grid-template-columns: minmax(0, 1fr);
                align-items: start;
            }
            .sp-native-label-view-banner .sp-view-banner-copy {
                align-items: flex-start;
                flex-direction: column;
            }
            .sp-native-label-view-banner .sp-view-banner-label {
                white-space: normal;
                overflow: visible;
                text-overflow: clip;
                line-height: 1.4;
            }
            .sp-view-banner-label {
                font-size: 12px;
                font-weight: 600;
                color: var(--sp-text-primary);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .sp-view-banner-meta {
                font-size: 11px;
                line-height: 1.35;
                color: var(--sp-text-secondary);
            }
            .sp-view-banner-btn {
                justify-self: end;
                flex-shrink: 0;
                padding: 5px 10px;
            }
            
            #sources-list {
                --sp-source-list-bottom-safe-area: 28px;
                overflow-y: auto;
                overflow-x: hidden;
                flex-grow: 1;
                min-height: 0;
                padding-right: 8px;
                padding-top: 4px;
                padding-bottom: var(--sp-source-list-bottom-safe-area);
                scroll-padding-bottom: var(--sp-source-list-bottom-safe-area);
                background: var(--sp-panel-bg);
                position: relative;
                isolation: isolate;
            }
            .sp-search-container {
                position: relative;
                display: flex;
                align-items: center;
                flex: 0 0 0;
                width: 0;
                min-width: 0;
                height: 34px;
                margin-left: 0;
                overflow: hidden;
                opacity: 0;
                pointer-events: none;
                border: 1px solid transparent;
                border-radius: 999px;
                background: transparent;
                box-shadow: none;
                transform-origin: right center;
                transition:
                    flex-basis var(--sp-motion-slow) var(--sp-ease-emphasized),
                    width var(--sp-motion-slow) var(--sp-ease-emphasized),
                    min-width var(--sp-motion-slow) var(--sp-ease-emphasized),
                    margin-left var(--sp-motion-slow) var(--sp-ease-emphasized),
                    opacity var(--sp-motion-base) var(--sp-ease-standard),
                    border-color var(--sp-motion-medium) var(--sp-ease-standard),
                    background-color var(--sp-motion-medium) var(--sp-ease-standard),
                    box-shadow var(--sp-motion-medium) var(--sp-ease-standard),
                    transform var(--sp-motion-slow) var(--sp-ease-emphasized);
            }
            .sp-search-container.is-expanded {
                flex: 0 1 min(300px, calc(100% - 42px));
                width: min(300px, calc(100% - 42px));
                min-width: 0;
                margin-left: 8px;
                opacity: 1;
                pointer-events: auto;
                border-color: var(--sp-border-medium);
                background-color: var(--sp-bg-button);
                box-shadow: 0 6px 18px rgba(0,0,0,0.08);
                transform: translateZ(0);
            }
            .sp-search-container.is-expanded:focus-within {
                background-color: var(--sp-bg-button);
                border-color: var(--sp-search-focus-border);
                box-shadow: var(--sp-search-focus-ring);
            }
            #sp-search {
                position: absolute;
                inset: 0;
                width: 100%;
                box-sizing: border-box;
                padding: 0 78px 0 12px;
                border: 0;
                border-radius: 0;
                font-size: 13px;
                font-weight: 500;
                background-color: transparent;
                color: var(--sp-text-primary);
                transition:
                    opacity var(--sp-motion-base) var(--sp-ease-standard),
                    transform var(--sp-motion-slow) var(--sp-ease-emphasized),
                    padding var(--sp-motion-slow) var(--sp-ease-emphasized);
                outline: none;
                box-shadow: none;
                opacity: 0;
                pointer-events: none;
                transform: translateX(18px);
            }
            .sp-search-container.is-expanded #sp-search {
                opacity: 1;
                pointer-events: auto;
                transform: translateX(0);
                transition-delay: 0.08s, 0.08s, 0.08s;
            }
            #sp-search:focus {
                background-color: transparent;
                transform: none;
            }
            #sp-search::-webkit-search-cancel-button {
                display: none;
            }
            .sp-search-cluster:focus-within .sp-search-trigger .google-symbols,
            .sp-search-cluster:focus-within .sp-search-close .google-symbols {
                color: var(--sp-accent);
            }
            #sp-search::placeholder {
                color: var(--sp-text-secondary);
            }
            .sp-search-count {
                position: absolute;
                right: 10px;
                max-width: 64px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                font-size: 11px;
                font-weight: 700;
                color: var(--sp-text-secondary);
                pointer-events: none;
                font-variant-numeric: tabular-nums;
                opacity: 0;
                transition: opacity var(--sp-motion-base) var(--sp-ease-standard);
            }
            .sp-search-container.is-expanded .sp-search-count:not([hidden]) {
                opacity: 1;
            }
            .sp-search-highlight {
                border-radius: 4px;
                padding: 0 2px;
                background: rgba(0, 122, 255, 0.16);
                color: var(--sp-text-primary);
                box-shadow: inset 0 0 0 1px rgba(0, 122, 255, 0.12);
            }
            
            .sp-icon-button {
                background: none;
                border: none;
                padding: 4px;
                display: flex;
                align-items: center;
                justify-content: center;
                color: var(--sp-text-secondary);
                cursor: pointer;
                border-radius: 8px;
                flex-shrink: 0;
                transition:
                    background-color var(--sp-motion-base) var(--sp-ease-standard),
                    color var(--sp-motion-base) var(--sp-ease-standard),
                    transform var(--sp-motion-fast) var(--sp-ease-press),
                    box-shadow var(--sp-motion-base) var(--sp-ease-standard),
                    border-color var(--sp-motion-base) var(--sp-ease-standard);
            }
            .sp-icon-button:hover {
                background-color: var(--sp-icon-button-hover);
                color: var(--sp-text-primary);
                transform: scale(1.06);
            }
            .sp-icon-button:active {
                transform: scale(0.95);
            }
            .sp-icon-button .google-symbols {
                font-size: 18px;
            }
            
            .sp-button {
                position: relative;
                overflow: hidden;
                border: 1px solid var(--sp-border-light);
                color: var(--sp-text-primary);
                background-color: var(--sp-bg-button);
                font-size: 13px;
                font-weight: 500;
                border-radius: 12px;
                padding: 6px 12px;
                cursor: pointer;
                transition:
                    background-color var(--sp-motion-base) var(--sp-ease-standard),
                    border-color var(--sp-motion-base) var(--sp-ease-standard),
                    box-shadow var(--sp-motion-base) var(--sp-ease-standard),
                    color var(--sp-motion-base) var(--sp-ease-standard),
                    transform var(--sp-motion-fast) var(--sp-ease-press);
                white-space: nowrap;
                box-shadow: var(--sp-shadow-button);
            }
            .sp-button:hover {
                background-color: var(--sp-bg-button-hover);
                border-color: var(--sp-border-medium);
                transform: scale(1.02);
            }
            .sp-button:active {
                background-color: var(--sp-bg-button-active);
                transform: scale(0.98);
            }
            
            /* --- Ultra Premium Custom Animated Checkboxes --- */
            .sp-checkbox { 
                box-sizing: border-box;
                appearance: none; -webkit-appearance: none; 
                width: 18px; height: 18px; 
                margin: 0; padding: 0;
                border: 2px solid var(--sp-text-secondary); /* High contrast border so it's clearly visible in both modes */
                border-radius: 6px; 
                cursor: pointer; 
                position: relative; 
                flex-shrink: 0; 
                background-color: var(--sp-bg-primary); 
                transition:
                    background-color var(--sp-motion-base) var(--sp-ease-standard),
                    border-color var(--sp-motion-base) var(--sp-ease-standard),
                    transform var(--sp-motion-fast) var(--sp-ease-press),
                    opacity var(--sp-motion-base) var(--sp-ease-standard);
            }
            .sp-checkbox:hover {
                border-color: var(--sp-accent);
                transform: scale(1.05);
            }
            .sp-checkbox:checked { 
                background-color: var(--sp-accent); 
                border-color: var(--sp-accent); 
                /* Removed implicit animation */
            }
            /* Explicit user-interaction animation */
            .sp-checkbox.is-animating:checked {
                animation: checkbox-spring var(--sp-motion-medium) var(--sp-ease-press);
            }
            
            /* The hidden checkmark shape inside the box */
            .sp-checkbox::before { 
                content: ''; 
                display: block; 
                position: absolute; 
                left: 0.5px; 
                bottom: 6px; 
                border: solid white; 
                border-width: 0 2.5px 2.5px 0; /* Thicker checkmark */
                border-radius: 1px;
                transform: rotate(45deg); 
                transform-origin: left bottom; /* Critical for growing outward correctly */
                
                /* Static base state for unselected */
                width: 0; 
                height: 0; 
                opacity: 0;
            }
            
            /* Static base state for successfully selected elements (avoiding re-render flickers) */
            /* MUST BE LOWER SPECIFICITY OR DECLARED BEFORE THE ANIMATION CLASS */
            .sp-checkbox:checked::before {
                width: 4.5px; 
                height: 10px; 
                opacity: 1;
            }

            /* Animate the checkmark drawing in using an organic, non-linear sequence ONLY on user interaction */
            .sp-checkbox.is-animating:checked::before { 
                /* ease-out decelerates at the very end of the stroke */
                animation: check-draw-organic var(--sp-motion-medium) var(--sp-ease-press) forwards !important;
                animation-delay: var(--sp-motion-fast) !important; /* Let the checkbox pop start and settle a bit first */
            }

            @keyframes check-draw-organic {
                0% {
                    width: 0;
                    height: 0;
                    opacity: 0;
                }
                10% {
                    width: 0;
                    height: 0;
                    opacity: 1;
                }
                40%  { width: 4.5px; height: 0;    opacity: 1; } /* Stroke 1: Draw short stem left-to-right */
                100% { width: 4.5px; height: 10px; opacity: 1; } /* Stroke 2: Whip up the long stem bottom-to-top */
            }

            @keyframes checkbox-spring {
                0% {
                    transform: scale(1);
                }
                30% {
                    transform: scale(0.7);
                }
                60% { transform: scale(1.15); } /* Overshoot */
                100% {
                    transform: scale(1);
                }
            }
            @keyframes sp-list-item-enter {
                0% {
                    opacity: 0;
                    transform: scale(0.985);
                }
                100% {
                    opacity: 1;
                    transform: scale(1);
                }
            }
            .source-item, .group-header {
                display: flex;
                align-items: center;
                padding: 6px 8px;
                border-radius: 12px;
                margin: 2px 0;
                transition:
                    background-color var(--sp-motion-base) var(--sp-ease-standard),
                    box-shadow var(--sp-motion-base) var(--sp-ease-standard),
                    border-color var(--sp-motion-base) var(--sp-ease-standard),
                    color var(--sp-motion-base) var(--sp-ease-standard),
                    transform var(--sp-motion-base) var(--sp-ease-standard);
                color: var(--sp-text-primary);
                position: relative;
                z-index: 1;
                transform-origin: left center;
                cursor: pointer;
                box-shadow: none;
            }
            .source-item {
                display: grid;
                grid-template-columns: 18px 24px minmax(0, 1fr) auto;
                column-gap: 8px;
                padding-left: 12px;
                border: 1px solid transparent;
                border-radius: 8px;
                margin-bottom: 2px;
                transition:
                    background-color var(--sp-motion-base) var(--sp-ease-standard),
                    box-shadow var(--sp-motion-base) var(--sp-ease-standard),
                    border-color var(--sp-motion-base) var(--sp-ease-standard),
                    transform var(--sp-motion-base) var(--sp-ease-standard);
            }
            .source-item.sp-list-item-enter,
            .group-container.sp-list-item-enter {
                animation: sp-list-item-enter var(--sp-motion-medium) var(--sp-ease-emphasized) backwards;
                animation-delay: calc(var(--sp-list-item-index, 0) * 18ms);
                transform-origin: left center;
            }
            .sp-spotlight-surface {
                overflow: hidden;
                isolation: isolate;
            }
            .source-item.sp-spotlight-surface::before,
            .group-header.sp-spotlight-surface::before {
                content: '';
                position: absolute;
                inset: 0;
                border-radius: inherit;
                pointer-events: none;
                z-index: 0;
                opacity: 0;
                background: radial-gradient(
                    circle at var(--sp-spotlight-x, 50%) var(--sp-spotlight-y, 50%),
                    var(--sp-spotlight-color),
                    transparent 62%
                );
                transition: opacity var(--sp-motion-base) var(--sp-ease-standard);
            }
            .source-item.sp-spotlight-surface > *,
            .group-header.sp-spotlight-surface > * {
                position: relative;
                z-index: 1;
            }
            .group-header {
                font-weight: 600;
                background-color: var(--sp-bg-primary);
            }
            .source-item:hover, .group-header:hover {
                background-color: var(--sp-bg-hover);
                z-index: 4;
                transform: scale(1.01);
                box-shadow: var(--sp-shadow-hover-item);
            }
            .source-item.sp-spotlight-surface:hover::before,
            .source-item.sp-spotlight-surface:focus-within::before,
            .source-item.sp-spotlight-surface.is-spotlight-active::before,
            .group-header.sp-spotlight-surface:hover::before,
            .group-header.sp-spotlight-surface:focus-within::before,
            .group-header.sp-spotlight-surface.is-spotlight-active::before {
                opacity: 1;
            }
            .source-item:active, .group-header:active {
                transform: scale(0.995);
            }
            .sp-caret {
                background: none;
                border: none;
                cursor: pointer;
                padding: 0 2px;
                transition:
                    transform var(--sp-motion-medium) var(--sp-ease-emphasized),
                    color var(--sp-motion-base) var(--sp-ease-standard),
                    box-shadow var(--sp-motion-base) var(--sp-ease-standard),
                    background-color var(--sp-motion-base) var(--sp-ease-standard);
                transform: rotate(0deg);
                color: var(--sp-text-secondary);
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .sp-caret .google-symbols {
                font-size: 20px;
            }
            .sp-caret.collapsed {
                transform: rotate(-90deg);
            }
            .icon-container {
                flex-shrink: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                width: 18px;
                height: 18px;
                overflow: hidden;
                color: var(--sp-text-secondary);
                transition:
                    color var(--sp-motion-base) var(--sp-ease-standard),
                    opacity var(--sp-motion-fast) var(--sp-ease-standard),
                    transform var(--sp-motion-fast) var(--sp-ease-press);
                cursor: pointer;
            }
            .icon-container:hover {
                transform: scale(1.04);
                opacity: 0.8;
            }
            .icon-container .google-symbols {
                font-size: 16px;
            }
            .sp-group-title-icon {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
                width: 18px;
                height: 18px;
                margin-right: 8px;
                color: var(--sp-text-secondary);
            }
            .sp-group-title-icon .google-symbols {
                font-size: 18px;
            }
            .source-icon-image {
                width: 18px;
                height: 18px;
                display: block;
                object-fit: cover;
                border-radius: 4px;
                overflow: hidden;
                pointer-events: none;
                user-select: none;
            }
            .sp-source-actions-anchor {
                position: relative;
                flex-shrink: 0;
                display: flex;
                align-items: center;
            }
            .sp-source-actions-placeholder {
                pointer-events: none;
            }
            .title-container, .group-title {
                flex-grow: 1;
                min-width: 0;
                font-size: 13px;
                color: var(--sp-text-primary);
                letter-spacing: -0.01em;
            }
            .title-container {
                display: flex;
                flex-direction: column;
                align-items: flex-start;
                gap: 4px;
                min-width: 0;
            }
            .source-title-text {
                width: 100%;
                line-height: 1.35;
                display: block;
                overflow: visible;
                white-space: normal;
                overflow-wrap: anywhere;
                word-break: break-word;
            }
            .source-loading-status {
                width: 100%;
                color: var(--sp-text-secondary);
                font-size: 11px;
                line-height: 1.2;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .source-tag-list {
                display: flex;
                flex-wrap: wrap;
                gap: 6px;
                width: 100%;
            }
            .sp-tag-pill {
                border: 1px solid var(--sp-tag-border, var(--sp-border-light));
                background: var(--sp-tag-bg, var(--sp-bg-secondary));
                color: var(--sp-tag-text, var(--sp-text-secondary));
                border-radius: 999px;
                padding: 2px 8px;
                font-size: 11px;
                line-height: 1.4;
                cursor: pointer;
                transition:
                    background-color var(--sp-motion-base) var(--sp-ease-standard),
                    border-color var(--sp-motion-base) var(--sp-ease-standard),
                    color var(--sp-motion-base) var(--sp-ease-standard);
            }
            .sp-tag-pill:hover {
                background: var(--sp-tag-hover-bg, var(--sp-bg-hover));
                color: var(--sp-tag-hover-text, var(--sp-text-primary));
                border-color: var(--sp-tag-hover-border, var(--sp-border-medium));
            }
            .sp-tag-pill.is-active {
                background: var(--sp-tag-active-bg);
                border-color: var(--sp-tag-active-border);
                color: var(--sp-tag-active-text);
            }
            .checkbox-container {
                flex-shrink: 0;
                justify-self: end;
                margin-left: 0;
                padding-left: 0;
                display: flex;
                align-items: center;
            }
            .sp-source-actions-button, .sp-add-subgroup-button, .sp-isolate-button, .sp-edit-button, .sp-delete-button {
                background: none;
                border: none;
                cursor: pointer;
                border-radius: 12px;
                width: 24px;
                height: 24px;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 0;
                color: var(--sp-text-secondary);
                flex-shrink: 0;
                transition:
                    background-color var(--sp-motion-base) var(--sp-ease-standard),
                    color var(--sp-motion-base) var(--sp-ease-standard),
                    opacity var(--sp-motion-base) var(--sp-ease-standard),
                    transform var(--sp-motion-fast) var(--sp-ease-press),
                    box-shadow var(--sp-motion-base) var(--sp-ease-standard);
            }
            .sp-source-actions-button .google-symbols,
            .sp-add-subgroup-button .google-symbols,
            .sp-isolate-button .google-symbols,
            .sp-edit-button .google-symbols,
            .sp-delete-button .google-symbols {
                font-size: 16px;
            }
            .sp-source-actions-button {
                opacity: 0.72;
            }
            .sp-source-actions-anchor.is-open .sp-source-actions-button,
            .source-item:hover .sp-source-actions-button {
                opacity: 1;
            }
            .sp-source-actions-button[disabled] {
                opacity: 0.35;
                cursor: not-allowed;
                transform: none;
            }
            .sp-source-actions-layer {
                position: fixed;
                inset: 0;
                pointer-events: none;
                z-index: 10002;
            }
            @keyframes sp-menu-surface-enter {
                0% {
                    opacity: 0;
                    transform: translateY(-4px) scale(0.96);
                }
                100% {
                    opacity: 1;
                    transform: translateY(0) scale(1);
                }
            }
            @keyframes sp-menu-surface-enter-top {
                0% {
                    opacity: 0;
                    transform: translateY(4px) scale(0.96);
                }
                100% {
                    opacity: 1;
                    transform: translateY(0) scale(1);
                }
            }
            @keyframes sp-menu-item-enter {
                0% {
                    opacity: 0;
                    transform: scale(0.96);
                }
                100% {
                    opacity: 1;
                    transform: scale(1);
                }
            }
            .sp-source-actions-menu {
                position: absolute;
                min-width: 170px;
                padding: 6px;
                display: flex;
                flex-direction: column;
                gap: 2px;
                border-radius: 14px;
                background: var(--sp-glass-bg-menu);
                backdrop-filter: blur(20px) saturate(160%);
                -webkit-backdrop-filter: blur(20px) saturate(160%);
                border: 1px solid var(--sp-glass-border);
                box-shadow: var(--sp-glass-shadow);
                pointer-events: auto;
                transform-origin: top left;
                animation: sp-menu-surface-enter var(--sp-motion-medium) var(--sp-ease-emphasized) both;
            }
            .sp-source-actions-menu.is-top {
                transform-origin: bottom left;
                animation-name: sp-menu-surface-enter-top;
            }
            .sp-source-actions-menu-item {
                width: 100%;
                border: none;
                background: transparent;
                color: var(--sp-text-primary);
                border-radius: 10px;
                padding: 8px 10px;
                display: flex;
                align-items: center;
                gap: 10px;
                text-align: left;
                cursor: pointer;
                animation: sp-menu-item-enter var(--sp-motion-fast) var(--sp-ease-emphasized) backwards;
                animation-delay: calc(var(--sp-menu-item-index, 0) * 24ms);
                transform-origin: center;
                transition:
                    background-color var(--sp-motion-base) var(--sp-ease-standard),
                    color var(--sp-motion-base) var(--sp-ease-standard),
                    transform var(--sp-motion-base) var(--sp-ease-standard);
            }
            .sp-source-actions-menu-item-content {
                min-width: 0;
                display: inline-flex;
                align-items: center;
                gap: 10px;
                flex: 1;
            }
            .sp-source-actions-menu-item.is-parent {
                justify-content: space-between;
            }
            .sp-source-actions-submenu {
                min-width: 190px;
            }
            .sp-source-actions-menu-item .google-symbols {
                font-size: 16px;
                color: var(--sp-text-secondary);
            }
            .sp-source-actions-menu-chevron {
                margin-left: 8px;
                transition:
                    transform var(--sp-motion-base) var(--sp-ease-standard),
                    color var(--sp-motion-base) var(--sp-ease-standard);
            }
            .sp-source-actions-menu-item.is-expanded .sp-source-actions-menu-chevron,
            .sp-source-actions-menu-item.is-parent:hover .sp-source-actions-menu-chevron {
                color: var(--sp-text-primary);
                transform: translateX(2px);
            }
            .sp-source-actions-menu-label {
                min-width: 0;
                font-size: 12px;
                line-height: 1.35;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .sp-glare-hover {
                position: relative;
                isolation: isolate;
            }
            .sp-glare-hover > * {
                position: relative;
                z-index: 1;
            }
            .sp-add-subgroup-button, .sp-isolate-button, .sp-edit-button, .sp-delete-button {
                display: flex;
                opacity: 0;
                transform: translateX(10px) scale(0.9);
                pointer-events: none;
                transition:
                    background-color var(--sp-motion-base) var(--sp-ease-standard),
                    color var(--sp-motion-base) var(--sp-ease-standard),
                    opacity var(--sp-motion-medium) var(--sp-ease-standard),
                    transform var(--sp-motion-medium) var(--sp-ease-emphasized),
                    box-shadow var(--sp-motion-base) var(--sp-ease-standard);
                margin-left: 2px;
            }
            .group-header:hover .sp-add-subgroup-button,
            .group-header:hover .sp-isolate-button,
            .group-header:hover .sp-edit-button,
            .group-header:hover .sp-delete-button,
            .group-header:focus-within .sp-add-subgroup-button,
            .group-header:focus-within .sp-isolate-button,
            .group-header:focus-within .sp-edit-button,
            .group-header:focus-within .sp-delete-button {
                opacity: 1;
                transform: translateX(0) scale(1);
                pointer-events: auto;
            }
            .group-title + .badge {
                margin-left: auto;
            }
            .sp-source-actions-button:hover, .sp-source-actions-menu-item:hover, .sp-add-subgroup-button:hover, .sp-isolate-button:hover, .sp-edit-button:hover {
                background-color: var(--sp-icon-button-hover);
                color: var(--sp-text-primary);
            }
            .sp-source-actions-button:hover, .sp-add-subgroup-button:hover, .sp-isolate-button:hover, .sp-edit-button:hover {
                transform: scale(1.06);
            }
            .sp-source-actions-menu-item:hover {
                transform: scale(1.02);
            }
            .sp-source-actions-menu-item[disabled] {
                opacity: 0.42;
                cursor: not-allowed;
                transform: none;
            }
            .sp-source-actions-menu-item[disabled]:hover {
                background-color: transparent;
                color: var(--sp-text-primary);
                transform: none;
            }
            .sp-source-actions-menu-item:hover .google-symbols {
                color: var(--sp-text-primary);
            }
            .sp-source-actions-button:focus-visible,
            .sp-source-actions-menu-item:focus-visible,
            .sp-add-subgroup-button:focus-visible,
            .sp-isolate-button:focus-visible,
            .sp-edit-button:focus-visible,
            .sp-delete-button:focus-visible,
            .sp-caret:focus-visible {
                outline: none;
                box-shadow: var(--sp-focus-ring);
                background-color: var(--sp-icon-button-hover);
                color: var(--sp-text-primary);
            }
            .sp-source-actions-menu-item:focus-visible {
                transform: translateX(2px);
            }
            .sp-isolate-button.is-active {
                opacity: 1;
                transform: translateX(0) scale(1);
                pointer-events: auto;
                color: var(--sp-accent);
                background-color: var(--sp-isolate-active-bg);
            }
            .sp-delete-button:hover {
                background-color: var(--sp-delete-hover-bg);
                color: var(--sp-accent-danger);
                transform: scale(1.06);
                box-shadow: inset 0 0 0 1px rgba(255, 59, 48, 0.18), 0 0 14px var(--sp-danger-glow);
            }
            .sp-source-actions-button:active, .sp-add-subgroup-button:active, .sp-isolate-button:active, .sp-edit-button:active, .sp-delete-button:active {
                transform: scale(0.95);
            }
            .icon-color {
                color: var(--sp-accent);
                } .youtube-icon-color { color: var(--sp-accent-danger);
                } .pdf-icon-color { color: var(--sp-accent-danger);
            }
            .group-container {
                display: flex;
                flex-direction: column;
                overflow: visible;
                margin-bottom: 2px;
                position: relative;
            }
            .source-item.gated, .group-container.gated > .group-children {
                opacity: 0.5;
                filter: grayscale(50%);
            }
            .failed-source {
                cursor: not-allowed;
            }
            .failed-source .title-container, .failed-source .icon-container {
                color: var(--sp-accent-danger) !important;
            }
            .failed-source .sp-checkbox {
                opacity: 0.5;
                cursor: not-allowed;
                border-color: var(--sp-accent-danger);
            }
            
            /* Loading State Visuals */
            .loading-source {
                cursor: wait;
            }
            .loading-source .title-container { 
                opacity: 0.6; 
                animation: pulse-text 2s cubic-bezier(0.25, 1, 0.5, 1) infinite; 
            }
            .loading-source .source-loading-status {
                color: var(--sp-accent);
            }
            .loading-source .sp-checkbox {
                opacity: 0;
                pointer-events: none;
            }
            .sp-spinner {
                width: 16px;
                height: 16px;
                border: 2px solid var(--sp-border-medium);
                border-top-color: var(--sp-accent);
                border-radius: 50%;
                animation: spin 1s linear infinite;
            }
            @keyframes spin {
                100% { transform: rotate(360deg);
                };
            }
            @keyframes pulse-text {
                0%, 100% {
                    opacity: 0.8;
                }
                50% {
                    opacity: 0.4;
                }
            }
            .group-children { 
                padding-left: 8px; 
                border-left: 2px solid var(--sp-border-light); 
                border-radius: 0 0 0 6px;
                margin-left: 18px; 
                margin-top: 2px; 
                overflow: visible; 
                transition:
                    border-color var(--sp-motion-base) var(--sp-ease-standard),
                    height var(--sp-motion-slow) var(--sp-ease-emphasized),
                    opacity var(--sp-motion-medium) var(--sp-ease-standard);
                opacity: 1;
                position: relative;
                /* By default, let height be auto. JS will set explicit heights during animation. */
            }
            .group-children.collapsed {
                height: 0;
                opacity: 0;
                margin-top: 0;
                border: none;
                overflow: hidden;
            }
            
            /* Folder Entry Animation */
            .sp-folder-enter {
                animation: sp-folder-pop var(--sp-motion-slow) var(--sp-ease-emphasized) forwards;
                transform-origin: top center;
            }
            @keyframes sp-folder-pop {
                0% {
                    opacity: 0;
                    transform: translateY(-10px) translateX(-5px) scale(0.95);
                }
                100% {
                    opacity: 1;
                    transform: translateY(0) translateX(0) scale(1);
                }
            }
            
            /* --- Move to Folder Modal & Overlay --- */
            @keyframes sp-modal-enter {
                0% {
                    opacity: 0;
                    transform: translate(-50%, -46%) scale(0.95);
                }
                100% {
                    opacity: 1;
                    transform: translate(-50%, -50%) scale(1);
                }
            }
            @keyframes sp-modal-leave {
                0% {
                    opacity: 1;
                    transform: translate(-50%, -50%) scale(1);
                }
                100% {
                    opacity: 0;
                    transform: translate(-50%, -54%) scale(0.95);
                }
            }
            @keyframes sp-modal-item-enter {
                0% {
                    opacity: 0;
                    transform: scale(0.97);
                }
                100% {
                    opacity: 1;
                    transform: scale(1);
                }
            }
            .sp-overlay-backdrop {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: var(--sp-overlay-backdrop);
                z-index: 10000;
                opacity: 0;
                transition: opacity var(--sp-motion-medium) var(--sp-ease-standard);
                pointer-events: none;
                display: flex;
                align-items: center;
                justify-content: center;
                backdrop-filter: blur(4px);
            }
            .sp-overlay-backdrop.visible {
                opacity: 1;
                pointer-events: auto;
            }
            .sp-folder-modal {
                position: fixed;
                top: 50%;
                left: 50%;
                width: 320px;
                max-height: 80vh;
                transform: translate(-50%, -50%);
                font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                background: var(--sp-modal-bg);
                backdrop-filter: blur(24px);
                -webkit-backdrop-filter: blur(24px);
                border: 1px solid var(--sp-modal-border);
                border-radius: 16px;
                box-shadow: var(--sp-modal-shadow);
                z-index: 10001;
                display: flex;
                flex-direction: column;
                overflow: hidden;
                opacity: 0;
                pointer-events: none;
                transition:
                    transform var(--sp-motion-slow) var(--sp-ease-standard),
                    opacity var(--sp-motion-slow) var(--sp-ease-standard);
            }
            
            .sp-folder-modal.visible {
                opacity: 1;
                pointer-events: auto;
                animation: sp-modal-enter var(--sp-motion-slow) var(--sp-ease-emphasized) forwards;
            }
            .sp-folder-modal.closing {
                animation: sp-modal-leave var(--sp-motion-slow) var(--sp-ease-emphasized) forwards;
            }
            .sp-folder-modal-header {
                padding: 16px 20px;
                border-bottom: 1px solid var(--sp-modal-divider);
            }
            .sp-folder-modal-title {
                font-size: 16px;
                font-weight: 500;
                color: var(--sp-text-primary);
                margin: 0;
            }
            .sp-folder-modal-content {
                padding: 8px;
                overflow-y: auto;
                flex-grow: 1;
                display: flex;
                flex-direction: column;
                gap: 4px;
            }
            
            /* Vertical option list style */
            .sp-folder-option {
                display: flex;
                align-items: center;
                padding: 10px 12px;
                border-radius: 10px;
                cursor: pointer;
                transition:
                    background-color var(--sp-motion-base) var(--sp-ease-standard),
                    color var(--sp-motion-base) var(--sp-ease-standard),
                    transform var(--sp-motion-base) var(--sp-ease-standard),
                    box-shadow var(--sp-motion-base) var(--sp-ease-standard);
                background: transparent;
                border: none;
                width: 100%;
                text-align: left;
            }
            .sp-folder-option,
            .sp-tag-option,
            .sp-tag-manage-item {
                animation: sp-modal-item-enter var(--sp-motion-medium) var(--sp-ease-emphasized) backwards;
                animation-delay: calc(var(--sp-modal-item-index, 0) * 24ms);
                transform-origin: center;
            }
            .sp-folder-option:hover,
            .sp-folder-option:focus-visible {
                background: var(--sp-bg-hover);
                transform: scale(1.02);
                outline: none;
            }
            .sp-folder-option .google-symbols {
                font-size: 20px;
                color: var(--sp-accent);
                margin-right: 12px;
                opacity: 0.8;
            }
            .sp-folder-option-title {
                font-size: 14px;
                color: var(--sp-text-primary);
                flex-grow: 1;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                font-weight: normal;
            }
            
            .sp-folder-empty {
                padding: 24px 16px;
                text-align: center;
                color: var(--sp-text-tertiary);
                font-size: 14px;
            }
            .sp-native-label-import-modal {
                width: min(420px, calc(100vw - 32px));
            }
            .sp-native-label-import-content {
                gap: 10px;
                padding: 12px;
            }
            .sp-native-label-import-summary {
                margin: 0;
                padding: 8px 10px;
                color: var(--sp-text-secondary);
                font-size: 13px;
                line-height: 1.4;
            }
            .sp-native-label-import-empty {
                padding: 24px 14px;
                color: var(--sp-text-secondary);
                font-size: 14px;
                line-height: 1.45;
                text-align: center;
            }
            .sp-native-label-import-item {
                padding: 10px;
                border: 1px solid var(--sp-border-light);
                border-radius: 8px;
                background: var(--sp-bg-secondary);
                animation: sp-modal-item-enter var(--sp-motion-medium) var(--sp-ease-emphasized) backwards;
                animation-delay: calc(var(--sp-modal-item-index, 0) * 24ms);
            }
            .sp-native-label-import-item-header {
                display: grid;
                grid-template-columns: auto minmax(0, 1fr) auto;
                align-items: center;
                gap: 8px;
            }
            .sp-native-label-import-item-header .google-symbols {
                color: var(--sp-accent);
                font-size: 20px;
            }
            .sp-native-label-import-title {
                color: var(--sp-text-primary);
                font-size: 14px;
                font-weight: 600;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .sp-native-label-import-count,
            .sp-native-label-import-action {
                color: var(--sp-text-tertiary);
                font-size: 12px;
            }
            .sp-native-label-import-action {
                margin-top: 6px;
            }
            .sp-native-label-import-source-list {
                margin: 8px 0 0;
                padding-left: 20px;
                color: var(--sp-text-secondary);
                font-size: 12px;
                line-height: 1.45;
            }
            .sp-native-label-import-source-list-empty {
                padding-left: 0;
            }
            .sp-native-label-import-more {
                color: var(--sp-text-tertiary);
            }
            .sp-folder-modal-footer {
                padding: 12px 16px;
                display: flex;
                justify-content: flex-end;
                border-top: 1px solid var(--sp-modal-divider);
                gap: 8px;
            }
            .sp-tag-modal-content {
                gap: 8px;
            }
            .sp-tag-editor {
                display: flex;
                flex-direction: column;
                gap: 8px;
                align-items: stretch;
            }
            .sp-tag-create-row,
            .sp-tag-edit-row {
                padding: 12px;
                border-radius: 12px;
                background: var(--sp-bg-primary);
                border: 1px solid var(--sp-border-light);
            }
            .sp-tag-input {
                width: 100%;
                box-sizing: border-box;
                padding: 8px 10px;
                border: 1px solid var(--sp-border-light);
                border-radius: 10px;
                background: var(--sp-bg-secondary);
                color: var(--sp-text-primary);
                font-size: 13px;
                outline: none;
            }
            .sp-tag-input:focus {
                border-color: var(--sp-accent);
                box-shadow: var(--sp-focus-ring-soft);
            }
            .sp-tag-color-group {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }
            .sp-tag-color-heading {
                font-size: 12px;
                color: var(--sp-text-secondary);
            }
            .sp-tag-color-presets {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
            }
            .sp-tag-color-swatch {
                width: 24px;
                height: 24px;
                border-radius: 999px;
                border: 2px solid transparent;
                cursor: pointer;
                transition:
                    transform var(--sp-motion-fast) var(--sp-ease-press),
                    box-shadow var(--sp-motion-base) var(--sp-ease-standard),
                    border-color var(--sp-motion-base) var(--sp-ease-standard);
                box-shadow: var(--sp-tag-swatch-inset);
            }
            .sp-tag-color-swatch:hover {
                transform: scale(1.05);
            }
            .sp-tag-color-swatch.is-active {
                border-color: var(--sp-text-primary);
                box-shadow: var(--sp-focus-ring-soft);
            }
            .sp-tag-color-swatch-none {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                color: var(--sp-text-secondary);
                background: var(--sp-bg-secondary);
                border-color: var(--sp-border-light);
                box-shadow: none;
            }
            .sp-tag-color-swatch-none .google-symbols {
                font-size: 15px;
            }
            .sp-tag-color-input-row {
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .sp-tag-color-trigger {
                display: inline-flex;
                align-items: center;
                gap: 8px;
                flex-shrink: 0;
            }
            .sp-tag-color-trigger-swatch {
                width: 14px;
                height: 14px;
                flex-shrink: 0;
                border-radius: 999px;
                border: 1px solid var(--sp-tag-color-trigger-border);
            }
            .sp-tag-color-native-input {
                position: absolute;
                width: 1px;
                height: 1px;
                opacity: 0;
                pointer-events: none;
            }
            .sp-tag-color-hex {
                font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
                letter-spacing: 0.02em;
            }
            .sp-tag-editor-actions {
                display: flex;
                justify-content: flex-end;
                gap: 8px;
            }
            .sp-tag-option,
            .sp-tag-row {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 10px 12px;
                border-radius: 10px;
                background: var(--sp-bg-primary);
                border: 1px solid var(--sp-border-light);
                transition:
                    background-color var(--sp-motion-base) var(--sp-ease-standard),
                    border-color var(--sp-motion-base) var(--sp-ease-standard),
                    box-shadow var(--sp-motion-base) var(--sp-ease-standard),
                    transform var(--sp-motion-base) var(--sp-ease-standard);
            }
            .sp-tag-option:hover,
            .sp-tag-option:focus-within,
            .sp-tag-row:hover,
            .sp-tag-row:focus-within {
                background: var(--sp-bg-hover);
                border-color: var(--sp-border-medium);
                transform: scale(1.01);
            }
            .sp-tag-option-checkbox {
                margin: 0;
            }
            .sp-tag-manage-item {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }
            .sp-tag-row-color {
                width: 14px;
                height: 14px;
                flex-shrink: 0;
                border-radius: 999px;
                border: 1px solid transparent;
                background: var(--sp-bg-secondary);
            }
            .sp-tag-row-color.is-neutral {
                border-color: var(--sp-border-light);
                background: linear-gradient(135deg, transparent 44%, var(--sp-text-secondary) 45%, var(--sp-text-secondary) 55%, transparent 56%), var(--sp-bg-secondary);
            }
            .sp-tag-option-label,
            .sp-tag-row-label {
                flex: 1;
                min-width: 0;
                font-size: 13px;
                color: var(--sp-text-primary);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .sp-tag-row-count {
                font-size: 12px;
                color: var(--sp-text-secondary);
                min-width: 18px;
                text-align: right;
            }
            .sp-tag-row-button {
                background: none;
                border: none;
                width: 28px;
                height: 28px;
                border-radius: 10px;
                cursor: pointer;
                color: var(--sp-text-secondary);
                display: inline-flex;
                align-items: center;
                justify-content: center;
                transition:
                    background-color var(--sp-motion-base) var(--sp-ease-standard),
                    color var(--sp-motion-base) var(--sp-ease-standard),
                    transform var(--sp-motion-fast) var(--sp-ease-press);
            }
            .sp-tag-row-button:hover {
                background: var(--sp-bg-hover);
                color: var(--sp-text-primary);
                transform: scale(1.06);
            }
            .sp-tag-row-button .google-symbols {
                font-size: 16px;
            }
            .sp-settings-modal {
                width: min(560px, calc(100vw - 32px));
            }
            .sp-settings-modal-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
            }
            .sp-settings-save-status-header {
                flex: 0 1 auto;
                min-width: 0;
                margin-left: auto;
            }
            .sp-settings-save-status-header[hidden] {
                display: none;
            }
            .sp-settings-save-status-header .sp-save-status {
                max-width: 240px;
            }
            .sp-welcome-modal {
                width: min(520px, calc(100vw - 32px));
            }
            .sp-welcome-header {
                display: grid;
                grid-template-columns: auto minmax(0, 1fr) auto;
                gap: 12px;
                align-items: start;
                padding: 18px 18px 8px;
            }
            .sp-welcome-brand-icon {
                width: 42px;
                height: 42px;
                border-radius: 14px;
                display: grid;
                place-items: center;
                color: var(--sp-accent);
                background: var(--sp-tag-active-bg);
                border: 1px solid var(--sp-tag-active-border);
                box-shadow: var(--sp-shadow-button);
            }
            .sp-welcome-brand-symbol {
                font-size: 22px;
            }
            .sp-welcome-heading {
                min-width: 0;
                display: grid;
                gap: 4px;
            }
            .sp-welcome-title {
                line-height: 1.25;
                overflow-wrap: anywhere;
            }
            .sp-welcome-subtitle {
                margin: 0;
                color: var(--sp-text-secondary);
                font-size: 13px;
                line-height: 1.45;
            }
            .sp-welcome-close-btn {
                margin-top: -2px;
            }
            .sp-welcome-content {
                padding: 10px 18px 0;
                gap: 14px;
            }
            .sp-welcome-feature-list {
                display: grid;
                gap: 10px;
            }
            .sp-welcome-feature-row {
                display: grid;
                grid-template-columns: auto minmax(0, 1fr);
                gap: 10px;
                align-items: start;
                padding: 10px;
                border-radius: 12px;
                background: var(--sp-bg-secondary);
                border: 1px solid var(--sp-border-light);
            }
            .sp-welcome-feature-icon {
                width: 28px;
                height: 28px;
                border-radius: 10px;
                display: grid;
                place-items: center;
                color: var(--sp-accent);
                background: var(--sp-bg-button);
                border: 1px solid var(--sp-border-light);
                font-size: 17px;
            }
            .sp-welcome-feature-copy {
                min-width: 0;
                display: grid;
                gap: 2px;
            }
            .sp-welcome-feature-title {
                margin: 0;
                font-size: 13px;
                font-weight: 700;
                color: var(--sp-text-primary);
            }
            .sp-welcome-feature-body {
                margin: 0;
                color: var(--sp-text-secondary);
                font-size: 12px;
                line-height: 1.45;
            }
            .sp-welcome-feedback-inline {
                display: flex;
                align-items: baseline;
                justify-content: flex-start;
                gap: 4px;
                flex-wrap: wrap;
                padding: 0 2px 2px;
            }
            .sp-welcome-feedback-copy {
                margin: 0;
                color: var(--sp-text-tertiary);
                font-size: 11px;
                line-height: 1.4;
            }
            .sp-welcome-feedback-link {
                appearance: none;
                border: 0;
                border-radius: 4px;
                padding: 0;
                background: transparent;
                color: var(--sp-accent);
                font: inherit;
                font-size: 11px;
                line-height: 1.4;
                cursor: pointer;
                text-decoration: underline;
                text-underline-offset: 2px;
                transition:
                    color var(--sp-motion-base) var(--sp-ease-standard),
                    box-shadow var(--sp-motion-base) var(--sp-ease-standard);
            }
            .sp-welcome-feedback-link:hover,
            .sp-welcome-feedback-link:focus-visible {
                color: var(--sp-accent);
            }
            .sp-welcome-feedback-link:focus-visible {
                outline: none;
                box-shadow: var(--sp-search-focus-ring);
            }
            .sp-welcome-footer {
                justify-content: flex-end;
            }
            .sp-welcome-primary-btn {
                background-color: var(--sp-accent);
                color: var(--sp-text-toast);
                border-color: transparent;
            }
            .sp-command-palette-modal {
                width: min(560px, calc(100vw - 32px));
            }
            .sp-command-palette-content {
                gap: 10px;
            }
            .sp-command-palette-input {
                width: 100%;
                box-sizing: border-box;
                border: 1px solid var(--sp-border-light);
                border-radius: 12px;
                padding: 10px 12px;
                background: var(--sp-bg-button);
                color: var(--sp-text-primary);
                font: inherit;
                font-size: 13px;
                outline: none;
                transition:
                    border-color var(--sp-motion-base) var(--sp-ease-standard),
                    box-shadow var(--sp-motion-base) var(--sp-ease-standard);
            }
            .sp-command-palette-input:focus {
                border-color: var(--sp-search-focus-border);
                box-shadow: var(--sp-search-focus-ring);
            }
            .sp-command-palette-list,
            .sp-tag-filter-list {
                display: grid;
                gap: 6px;
            }
            .sp-command-palette-item,
            .sp-tag-filter-option {
                width: 100%;
                border: 1px solid var(--sp-border-light);
                border-radius: 10px;
                padding: 9px 10px;
                background: var(--sp-bg-button);
                color: var(--sp-text-primary);
                cursor: pointer;
                text-align: left;
                transition:
                    background-color var(--sp-motion-base) var(--sp-ease-standard),
                    border-color var(--sp-motion-base) var(--sp-ease-standard),
                    color var(--sp-motion-base) var(--sp-ease-standard),
                    box-shadow var(--sp-motion-base) var(--sp-ease-standard);
            }
            .sp-command-palette-item {
                display: grid;
                grid-template-columns: 24px minmax(0, 1fr) auto;
                align-items: center;
                gap: 10px;
                box-sizing: border-box;
            }
            .sp-command-palette-item:hover,
            .sp-command-palette-item:focus-visible,
            .sp-command-palette-item.is-active,
            .sp-tag-filter-option:hover,
            .sp-tag-filter-option:focus-visible {
                border-color: var(--sp-search-focus-border);
                background: var(--sp-tag-active-bg);
            }
            .sp-command-palette-item.is-disabled {
                cursor: not-allowed;
                opacity: 0.55;
            }
            .sp-command-palette-item:focus-visible,
            .sp-tag-filter-option:focus-visible {
                outline: none;
                box-shadow: var(--sp-search-focus-ring);
            }
            .sp-command-palette-copy {
                min-width: 0;
                display: grid;
                gap: 2px;
            }
            .sp-command-palette-title {
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                font-size: 13px;
                font-weight: 700;
            }
            .sp-command-palette-subtitle,
            .sp-command-palette-empty,
            .sp-settings-preview-diff-row,
            .sp-settings-import-warning {
                color: var(--sp-text-secondary);
                font-size: 12px;
                line-height: 1.4;
            }
            .sp-command-palette-icon {
                color: var(--sp-accent);
            }
            .sp-command-shortcut-btn {
                border: 1px solid var(--sp-border-light);
                border-radius: 8px;
                padding: 4px 8px;
                min-width: 74px;
                max-width: 132px;
                background: var(--sp-bg-secondary);
                color: var(--sp-text-secondary);
                font: inherit;
                font-size: 11px;
                font-weight: 650;
                line-height: 1.2;
                text-align: center;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                cursor: pointer;
                transition:
                    background-color var(--sp-motion-base) var(--sp-ease-standard),
                    border-color var(--sp-motion-base) var(--sp-ease-standard),
                    color var(--sp-motion-base) var(--sp-ease-standard);
            }
            .sp-command-shortcut-btn:hover,
            .sp-command-shortcut-btn:focus-visible,
            .sp-command-shortcut-btn.is-recording {
                border-color: var(--sp-search-focus-border);
                color: var(--sp-accent);
                background: var(--sp-tag-active-bg);
                outline: none;
            }
            .sp-settings-import-warning {
                border: 1px solid var(--sp-border-light);
                border-radius: 10px;
                padding: 8px 10px;
                background: var(--sp-bg-secondary);
            }
            .sp-settings-preview-diff {
                display: grid;
                gap: 4px;
            }
            .sp-settings-modal-content {
                padding: 12px;
                gap: 12px;
            }
            .sp-settings-section {
                display: flex;
                flex-direction: column;
                gap: 8px;
                padding: 12px;
                border: 1px solid var(--sp-modal-divider);
                border-radius: 12px;
                background: var(--sp-bg-secondary);
            }
            .sp-settings-section-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
            }
            .sp-settings-action-row {
                display: flex;
                align-items: center;
                justify-content: flex-end;
                gap: 8px;
                flex-wrap: wrap;
            }
            .sp-settings-section-title {
                margin: 0;
                font-size: 13px;
                font-weight: 700;
                color: var(--sp-text-primary);
            }
            .sp-settings-subsection {
                display: grid;
                gap: 8px;
                padding: 0;
            }
            .sp-settings-subsection + .sp-settings-subsection {
                padding-top: 10px;
                border-top: 1px solid var(--sp-modal-divider);
            }
            .sp-settings-subsection-title {
                margin: 0;
                font-size: 12px;
                font-weight: 700;
                color: var(--sp-text-primary);
            }
            .sp-settings-preference-row {
                display: grid;
                grid-template-columns: minmax(0, 1fr) minmax(132px, auto);
                gap: 10px;
                align-items: center;
            }
            .sp-settings-preference-copy {
                min-width: 0;
                display: grid;
                gap: 2px;
            }
            .sp-settings-preference-title {
                color: var(--sp-text-primary);
                font-size: 12px;
                font-weight: 700;
                line-height: 1.35;
            }
            .sp-settings-select {
                min-width: 132px;
                max-width: 220px;
                border: 1px solid var(--sp-border-light);
                border-radius: 8px;
                background: var(--sp-bg-button);
                color: var(--sp-text-primary);
                font: inherit;
                font-size: 12px;
                padding: 6px 8px;
                outline: none;
                transition:
                    border-color var(--sp-motion-base) var(--sp-ease-standard),
                    box-shadow var(--sp-motion-base) var(--sp-ease-standard),
                    background-color var(--sp-motion-base) var(--sp-ease-standard);
            }
            .sp-settings-select:focus {
                border-color: var(--sp-search-focus-border);
                box-shadow: var(--sp-search-focus-ring);
            }
            .sp-quick-view-visibility-list {
                display: grid;
                gap: 8px;
            }
            .sp-quick-view-visibility-row {
                display: flex;
                align-items: center;
                gap: 10px;
                min-height: 36px;
                padding: 8px 10px;
                border: 1px solid var(--sp-border-light);
                border-radius: 10px;
                background: var(--sp-bg-secondary);
                color: var(--sp-text-primary);
                font-size: 13px;
                font-weight: 600;
                line-height: 1.3;
            }
            .sp-quick-view-visibility-checkbox {
                width: 16px;
                height: 16px;
                margin: 0;
                accent-color: var(--sp-accent);
            }
            .sp-settings-developer-unlock-row {
                display: flex;
                justify-content: center;
                padding: 2px 0 0;
            }
            .sp-settings-developer-unlock-btn {
                border: 0;
                border-radius: 6px;
                padding: 2px 6px;
                background: transparent;
                color: var(--sp-text-tertiary);
                font: inherit;
                font-size: 11px;
                line-height: 1.4;
                cursor: pointer;
                transition:
                    color var(--sp-motion-base) var(--sp-ease-standard),
                    background-color var(--sp-motion-base) var(--sp-ease-standard),
                    box-shadow var(--sp-motion-base) var(--sp-ease-standard);
            }
            .sp-settings-developer-unlock-btn:hover,
            .sp-settings-developer-unlock-btn:focus-visible {
                color: var(--sp-accent);
                background: var(--sp-bg-hover);
            }
            .sp-settings-developer-unlock-btn:focus-visible {
                outline: none;
                box-shadow: var(--sp-search-focus-ring);
            }
            .sp-settings-collapsible-section {
                gap: 0;
            }
            .sp-settings-collapsible-header {
                align-items: stretch;
            }
            .sp-settings-collapsible-toggle {
                width: 100%;
                min-height: 24px;
                border: 0;
                border-radius: 8px;
                padding: 0;
                background: transparent;
                color: var(--sp-text-primary);
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                text-align: left;
                transition:
                    color var(--sp-motion-base) var(--sp-ease-standard),
                    background-color var(--sp-motion-base) var(--sp-ease-standard),
                    box-shadow var(--sp-motion-base) var(--sp-ease-standard);
            }
            .sp-settings-collapsible-toggle:hover,
            .sp-settings-collapsible-toggle:focus-visible {
                color: var(--sp-accent);
            }
            .sp-settings-collapsible-toggle:focus-visible {
                outline: none;
                box-shadow: var(--sp-search-focus-ring);
            }
            .sp-settings-collapsible-chevron {
                flex: 0 0 auto;
                font-size: 20px;
                color: var(--sp-text-secondary);
                transition:
                    color var(--sp-motion-base) var(--sp-ease-standard),
                    transform var(--sp-motion-medium) var(--sp-ease-emphasized);
            }
            .sp-settings-collapsible-toggle:hover .sp-settings-collapsible-chevron,
            .sp-settings-collapsible-toggle:focus-visible .sp-settings-collapsible-chevron {
                color: var(--sp-accent);
            }
            .sp-settings-collapsible-section.is-expanded .sp-settings-collapsible-chevron {
                transform: rotate(180deg);
            }
            .sp-settings-collapsible-body {
                display: grid;
                grid-template-rows: 0fr;
                opacity: 0;
                transform: translateY(-4px);
                transition:
                    grid-template-rows var(--sp-motion-medium) var(--sp-ease-emphasized),
                    opacity var(--sp-motion-base) var(--sp-ease-standard),
                    transform var(--sp-motion-medium) var(--sp-ease-emphasized);
            }
            .sp-settings-collapsible-section.is-expanded .sp-settings-collapsible-body {
                grid-template-rows: 1fr;
                opacity: 1;
                transform: translateY(0);
            }
            .sp-settings-collapsible-inner {
                min-height: 0;
                overflow: hidden;
                display: grid;
                gap: 8px;
            }
            .sp-settings-collapsible-section.is-expanded .sp-settings-collapsible-inner {
                padding-top: 8px;
            }
            .sp-settings-collapsible-actions {
                justify-content: flex-start;
            }
            .sp-settings-file-input {
                display: none;
            }
            .sp-settings-textarea {
                width: 100%;
                min-height: 116px;
                box-sizing: border-box;
                resize: vertical;
                border: 1px solid var(--sp-border-light);
                border-radius: 10px;
                padding: 10px;
                background: var(--sp-bg-button);
                color: var(--sp-text-primary);
                font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
                outline: none;
                transition:
                    border-color var(--sp-motion-base) var(--sp-ease-standard),
                    box-shadow var(--sp-motion-base) var(--sp-ease-standard),
                    background-color var(--sp-motion-base) var(--sp-ease-standard);
            }
            .sp-settings-textarea:focus {
                border-color: var(--sp-search-focus-border);
                box-shadow: var(--sp-search-focus-ring);
            }
            .sp-settings-import-preview {
                min-height: 18px;
                font-size: 12px;
                color: var(--sp-text-secondary);
                display: flex;
                flex-direction: column;
                gap: 8px;
            }
            .sp-settings-import-preview.is-valid {
                color: var(--sp-accent);
            }
            .sp-settings-import-preview.is-invalid {
                color: var(--sp-accent-danger);
            }
            .sp-settings-preview-details {
                display: grid;
                gap: 6px;
                color: var(--sp-text-secondary);
            }
            .sp-settings-preview-detail-title {
                color: var(--sp-text-primary);
                font-size: 11px;
                font-weight: 700;
            }
            .sp-settings-preview-list {
                display: grid;
                gap: 4px;
                margin: 0;
                padding: 0;
                list-style: none;
            }
            .sp-settings-preview-item,
            .sp-settings-preview-empty,
            .sp-settings-preview-more {
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                color: var(--sp-text-secondary);
            }
            .sp-settings-helper-text,
            .sp-settings-empty-state {
                margin: 0;
                font-size: 12px;
                line-height: 1.45;
                color: var(--sp-text-secondary);
            }
            .sp-source-repair-list,
            .sp-history-list {
                display: grid;
                gap: 8px;
            }
            .sp-source-repair-item,
            .sp-history-item {
                display: grid;
                grid-template-columns: minmax(0, 1fr) minmax(150px, auto);
                gap: 10px;
                align-items: center;
                padding: 8px;
                border: 1px solid var(--sp-border-light);
                border-radius: 10px;
                background: var(--sp-bg-secondary);
            }
            .sp-history-item {
                grid-template-columns: minmax(0, 1fr) max-content;
                align-items: start;
            }
            .sp-history-copy {
                min-width: 0;
            }
            .sp-source-repair-title,
            .sp-history-title {
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                color: var(--sp-text-primary);
                font-size: 12px;
                font-weight: 700;
            }
            .sp-history-title {
                overflow: visible;
                text-overflow: clip;
                white-space: normal;
                overflow-wrap: anywhere;
                line-height: 1.35;
            }
            .sp-source-repair-meta,
            .sp-history-meta {
                margin-top: 2px;
                color: var(--sp-text-secondary);
                font-size: 11px;
            }
            .sp-history-restore-btn {
                min-width: 72px;
                justify-self: end;
            }
            .sp-source-repair-select {
                min-width: 150px;
                max-width: 220px;
                border: 1px solid var(--sp-border-light);
                border-radius: 8px;
                background: var(--sp-bg-button);
                color: var(--sp-text-primary);
                font-size: 12px;
                padding: 6px 8px;
            }
            .sp-settings-diagnostics-grid {
                display: grid;
                grid-template-columns: minmax(110px, max-content) minmax(0, 1fr);
                gap: 6px 10px;
                font-size: 11px;
                color: var(--sp-text-secondary);
            }
            .sp-settings-diagnostics-key {
                font-weight: 700;
                color: var(--sp-text-primary);
            }
            .sp-settings-diagnostics-value {
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
            }
            .sp-settings-apply-import-btn {
                background-color: var(--sp-accent);
                color: white;
                border-color: transparent;
            }
            .sp-settings-apply-import-btn:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
            .sp-modal-cancel {
                background: var(--sp-bg-secondary);
                color: var(--sp-text-primary);
                border: 1px solid var(--sp-border-light);
                padding: 8px 16px;
                border-radius: 8px;
                font-size: 13px;
                font-weight: 500;
                cursor: pointer;
                transition:
                    background-color var(--sp-motion-base) var(--sp-ease-standard),
                    border-color var(--sp-motion-base) var(--sp-ease-standard),
                    color var(--sp-motion-base) var(--sp-ease-standard),
                    transform var(--sp-motion-fast) var(--sp-ease-press);
            }
            .sp-modal-cancel:hover {
                background: var(--sp-bg-hover);
                transform: scale(1.02);
            }
            .sp-modal-cancel:active {
                transform: scale(0.98);
            }

            .ungrouped-header {
                margin: 16px 0 6px 8px;
                color: var(--sp-text-secondary);
                font-size: 11px;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.05em;
            }

            .source-item.dragging,
            .group-header.dragging {
                opacity: 0.95;
                background-color: var(--sp-bg-button);
                transform: scale(1.03) translateY(-2px);
                box-shadow: var(--sp-shadow-toast);
                border: 1px solid var(--sp-accent);
                z-index: 10;
                cursor: grabbing;
                transition: none;
            }

            .sp-drag-folded {
                transition: height 200ms cubic-bezier(0.2, 0, 0, 1), opacity 200ms cubic-bezier(0.2, 0, 0, 1);
                overflow: hidden;
                pointer-events: none;
            }

            .sp-drop-shift {
                transition: transform 200ms cubic-bezier(0.2, 0, 0, 1);
                will-change: transform;
            }

            .group-container.drag-into > .group-header {
                background-color: var(--sp-drag-into-bg);
                border-radius: 12px;
            }

            .sp-toast {
                visibility: hidden;
                min-width: 200px;
                max-width: min(420px, calc(100vw - 32px));
                background-color: var(--sp-bg-toast);
                color: var(--sp-text-toast);
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 10px;
                text-align: left;
                border-radius: 12px;
                padding: 12px 16px;
                position: fixed;
                z-index: 9999;
                left: 50%;
                bottom: 30px;
                transform: translateX(-50%) translateY(20px) scale(0.9);
                font-size: 14px;
                font-weight: 500;
                opacity: 0;
                filter: blur(4px);
                transition:
                    opacity var(--sp-motion-medium) var(--sp-ease-standard),
                    transform var(--sp-motion-medium) var(--sp-ease-emphasized),
                    filter var(--sp-motion-medium) var(--sp-ease-standard),
                    background-color var(--sp-motion-base) var(--sp-ease-standard);
	                backdrop-filter: blur(10px);
	                box-shadow: var(--sp-shadow-toast);
	            }

	            .sp-toast-success {
	                background-color: rgba(34, 128, 75, 0.92);
	                color: #fff;
	            }

	            .sp-toast-error {
	                background-color: rgba(196, 42, 36, 0.94);
	                color: #fff;
	                box-shadow: var(--sp-shadow-toast), 0 0 18px var(--sp-danger-glow);
	            }

	            .sp-toast-message {
	                min-width: 0;
	                overflow-wrap: anywhere;
	            }

	            .sp-toast-action {
	                appearance: none;
	                border: 1px solid rgba(255, 255, 255, 0.34);
	                border-radius: 999px;
	                background: rgba(255, 255, 255, 0.16);
	                color: inherit;
	                cursor: pointer;
	                font: inherit;
	                font-weight: 700;
	                padding: 5px 10px;
	                transition:
	                    background-color var(--sp-motion-fast) var(--sp-ease-standard),
	                    border-color var(--sp-motion-fast) var(--sp-ease-standard),
	                    transform var(--sp-motion-fast) var(--sp-ease-press);
	            }

	            .sp-toast-action:hover,
	            .sp-toast-action:focus-visible {
	                background: rgba(255, 255, 255, 0.24);
	                border-color: rgba(255, 255, 255, 0.48);
	                outline: none;
	                transform: scale(1.03);
	            }

	            .sp-toast-action:active {
	                transform: scale(0.97);
	            }

            .sp-toast.show {
                visibility: visible;
                opacity: 1;
                transform: translateX(-50%) translateY(0) scale(1);
                filter: blur(0);
            }

            .badge {
                font-size: 11px;
                color: var(--sp-text-badge);
                margin-left: 6px;
                font-weight: 500;
                font-variant-numeric: tabular-nums;
                flex-shrink: 0;
                background: var(--sp-bg-badge);
                padding: 2px 6px;
                border-radius: 12px;
            }

            .sp-count-up-number {
                display: inline-block;
                min-width: 1ch;
                text-align: center;
                font-variant-numeric: tabular-nums;
                line-height: 1;
            }

            .sp-toggle-switch {
                position: relative;
                display: inline-block;
                width: 36px;
                height: 20px;
                margin: 0 8px 0 2px;
                flex-shrink: 0;
                transform: scale(0.9);
            }
            .sp-toggle-switch:hover .sp-toggle-slider {
                box-shadow: inset 0 0 0 1px var(--sp-border-medium);
            }

            .sp-toggle-switch .sp-group-toggle-checkbox {
                opacity: 0;
                width: 0;
                height: 0;
            }

            .sp-toggle-slider {
                position: absolute;
                cursor: pointer;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background-color: var(--sp-bg-switch);
                transition:
                    background-color var(--sp-motion-base) var(--sp-ease-standard),
                    box-shadow var(--sp-motion-base) var(--sp-ease-standard);
                border-radius: 18px;
                box-shadow: inset 0 0 0 1px var(--sp-border-light);
            }

            .sp-toggle-slider:before {
                position: absolute;
                content: "";
                height: 16px;
                width: 16px;
                left: 2px;
                bottom: 2px;
                background-color: var(--sp-bg-switch-thumb);
                transition:
                    transform var(--sp-motion-base) var(--sp-ease-emphasized),
                    background-color var(--sp-motion-base) var(--sp-ease-standard),
                    box-shadow var(--sp-motion-base) var(--sp-ease-standard);
                border-radius: 50%;
                box-shadow: var(--sp-shadow-switch-thumb);
            }

            .sp-group-toggle-checkbox:checked + .sp-toggle-slider {
                background-color: var(--sp-accent-success);
                box-shadow: inset 0 0 0 1px rgba(0,0,0,0.1);
            }

            .sp-group-toggle-checkbox:checked + .sp-toggle-slider:before {
                transform: translateX(16px);
            }
            
            /* --- Batch Mode Additions --- */
            .source-item.selected-for-batch {
                background-color: var(--sp-batch-selected-bg);
                border: 1px dashed var(--sp-accent);
                box-shadow: inset 0 0 0 1px rgba(0, 122, 255, 0.08);
                transition:
                    background-color var(--sp-motion-base) var(--sp-ease-standard),
                    border-color var(--sp-motion-base) var(--sp-ease-standard),
                    box-shadow var(--sp-motion-base) var(--sp-ease-standard),
                    transform var(--sp-motion-base) var(--sp-ease-standard);
            }
            .sp-batch-checkbox {
                border-color: var(--sp-accent);
                background-color: var(--sp-batch-checkbox-bg);
            }
            .sp-batch-checkbox:checked {
                background-color: var(--sp-accent);
                border-color: var(--sp-accent);
            }
            @keyframes sp-batch-bar-enter {
                0% {
                    opacity: 0;
                    transform: translateY(8px) scale(0.98);
                }
                100% {
                    opacity: 1;
                    transform: translateY(0) scale(1);
                }
            }
            .sp-batch-action-bar {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 8px;
                padding: 12px 16px;
                margin-top: 8px;
                position: sticky;
                bottom: 8px;
                background: var(--sp-glass-bg-body, rgba(255, 255, 255, 0.85));
                backdrop-filter: blur(20px) saturate(180%);
                -webkit-backdrop-filter: blur(20px) saturate(180%);
                border: 1px solid var(--sp-glass-border, rgba(0, 0, 0, 0.05));
                border-radius: 16px;
                box-shadow:
                    var(--sp-glass-shadow),
                    inset 0 0 0 1px rgba(0, 122, 255, 0.08),
                    0 0 18px var(--sp-batch-glow);
                z-index: 5;
                overflow: hidden;
                isolation: isolate;
                animation: sp-batch-bar-enter var(--sp-motion-medium) var(--sp-ease-emphasized) both;
                transition:
                    background-color var(--sp-motion-base) var(--sp-ease-standard),
                    border-color var(--sp-motion-base) var(--sp-ease-standard),
                    box-shadow var(--sp-motion-base) var(--sp-ease-standard),
                    transform var(--sp-motion-base) var(--sp-ease-standard);
            }
            .sp-batch-action-bar::before {
                content: '';
                position: absolute;
                inset: 0;
                border-radius: inherit;
                pointer-events: none;
                box-shadow:
                    inset 0 1px 0 rgba(255, 255, 255, 0.2),
                    inset 0 0 0 1px var(--sp-batch-glow);
                opacity: 0.75;
                z-index: 0;
            }
            .sp-batch-action-bar > * {
                position: relative;
                z-index: 1;
            }
	            .sp-batch-actions {
	                display: flex;
	                flex-wrap: wrap;
	                justify-content: flex-end;
	                gap: 8px;
	            }
	            .sp-batch-add-folder-btn,
	            .sp-batch-add-tags-btn {
	                background-color: var(--sp-accent);
	                color: white;
	                border-color: transparent;
	            }
	            .sp-batch-add-folder-btn:hover,
	            .sp-batch-add-tags-btn:hover {
	                background-color: #0066cc;
	            }
	            .sp-batch-remove-tags-btn,
	            .sp-batch-ungroup-btn {
	                background-color: var(--sp-bg-button);
	                color: var(--sp-text-primary);
	                border-color: var(--sp-border-light);
	            }
	            .sp-batch-remove-tags-btn:hover,
	            .sp-batch-ungroup-btn:hover {
	                border-color: var(--sp-accent);
	                box-shadow: inset 0 0 0 1px rgba(0, 122, 255, 0.08), 0 0 12px var(--sp-batch-glow);
	            }
	            .sp-batch-add-folder-btn:disabled,
	            .sp-batch-add-tags-btn:disabled,
	            .sp-batch-remove-tags-btn:disabled,
	            .sp-batch-ungroup-btn:disabled {
	                opacity: 0.5;
	                cursor: not-allowed;
	            }
            .sp-confirm-delete-btn {
                background-color: var(--sp-accent-danger);
                color: white;
                border-color: transparent;
            }
            .sp-confirm-delete-btn:hover {
                background-color: #ff2d20;
                box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18), 0 0 16px var(--sp-danger-glow);
            }
            .sp-confirm-delete-btn:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }

            /* =========================================
               UI Polish Part 2
               ========================================= */

            /* 1. Empty Drop Zone Styling */
            .sp-empty-state {
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 16px;
                margin: 4px 8px 8px 18px;
                border: 2px dashed var(--sp-border-medium);
                border-radius: 12px;
                color: var(--sp-text-secondary);
                font-size: 13px;
                font-weight: 500;
                background-color: var(--sp-empty-state-bg);
                transition:
                    background-color var(--sp-motion-base) var(--sp-ease-standard),
                    border-color var(--sp-motion-base) var(--sp-ease-standard),
                    color var(--sp-motion-base) var(--sp-ease-standard),
                    transform var(--sp-motion-base) var(--sp-ease-standard);
            }
            .group-container.drag-into > .group-children > .sp-empty-state {
                background-color: var(--sp-drag-into-bg);
                border-color: var(--sp-accent);
                color: var(--sp-accent);
                transform: scale(1.02);
            }
            
            /* =========================================
               UI Polish Part 3: Typography & Layout
               ========================================= */

            #sources-list:not(:empty) {
                padding-top: 0;
            }

            .group-title {
                white-space: normal;
                display: -webkit-box;
                -webkit-line-clamp: 2;
                -webkit-box-orient: vertical;
                overflow: hidden;
                line-height: 1.4;
                margin-right: 4px;
            }
            .group-name {
                font-weight: 500;
                letter-spacing: 0.1px;
            }

            .sp-cancel-batch-btn {
                flex: 0 0 auto;
                min-width: 72px;
                background: transparent;
                border: 1px solid var(--sp-border-light);
            }

            /* =========================================
               UI Polish & Enhancements
               ========================================= */

            /* 1. Custom Webkit Scrollbar */
            #sources-list::-webkit-scrollbar {
                width: 6px;
                height: 6px;
            }
            #sources-list::-webkit-scrollbar-track {
                background: transparent;
            }
            #sources-list::-webkit-scrollbar-thumb {
                background: var(--sp-scrollbar-thumb);
                border-radius: 10px;
            }
            #sources-list::-webkit-scrollbar-thumb:hover {
                background: var(--sp-scrollbar-thumb-hover);
            }
            .group-container:hover > .group-children {
                border-left-color: var(--sp-accent);
            }
            
            /* Enhanced Drag Feedback */
	            .drag-over-top {
	                border-top: 2px solid var(--sp-accent) !important;
	                position: relative;
	                box-shadow: 0 -6px 14px rgba(0, 122, 255, 0.12);
	            }
            .drag-over-top::before {
                content: '';
                position: absolute;
                top: -5px;
                left: -5px;
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background-color: var(--sp-accent);
                border: 2px solid var(--sp-bg-primary, white);
                z-index: 10;
            }
            
	            .drag-over-bottom {
	                border-bottom: 2px solid var(--sp-accent) !important;
	                position: relative;
	                box-shadow: 0 6px 14px rgba(0, 122, 255, 0.12);
	            }
            .drag-over-bottom::after {
                content: '';
                position: absolute;
                bottom: -5px;
                left: -5px;
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background-color: var(--sp-accent);
                border: 2px solid var(--sp-bg-primary, white);
                z-index: 10;
            }

            .drag-over-top.drag-invalid {
                border-top-color: var(--sp-accent-danger) !important;
                box-shadow: 0 -6px 14px rgba(255, 59, 48, 0.12);
            }
            .drag-over-bottom.drag-invalid {
                border-bottom-color: var(--sp-accent-danger) !important;
                box-shadow: 0 6px 14px rgba(255, 59, 48, 0.12);
            }
            .drag-invalid {
                cursor: not-allowed;
            }
            .drag-over-top.drag-invalid::before,
            .drag-over-bottom.drag-invalid::after {
                background-color: var(--sp-accent-danger);
            }
            .group-container.drag-invalid > .group-header {
                background-color: rgba(255, 59, 48, 0.08);
                outline: 1px solid var(--sp-accent-danger);
                outline-offset: -1px;
            }
            @media (prefers-color-scheme: dark) {
                .group-container.drag-invalid > .group-header {
                    background-color: rgba(255, 69, 58, 0.12);
                }
            }

            @media (prefers-reduced-motion: reduce) {
                :host {
                    --sp-motion-fast: 1ms;
                    --sp-motion-base: 1ms;
                    --sp-motion-medium: 1ms;
                    --sp-motion-slow: 1ms;
                }

                *,
                *::before,
                *::after {
                    animation-duration: 1ms !important;
                    animation-iteration-count: 1 !important;
                    transition-duration: 1ms !important;
                    scroll-behavior: auto !important;
                }

                .sp-spinner {
                    animation: spin 1s linear infinite !important;
                }

                .loading-source .title-container,
                .sp-folder-enter,
                .source-item.sp-list-item-enter,
                .group-container.sp-list-item-enter,
                .sp-source-actions-menu,
                .sp-source-actions-menu-item,
                .sp-folder-option,
                .sp-tag-option,
                .sp-tag-manage-item,
                .sp-batch-action-bar,
                .source-item.selected-for-batch,
                .sp-folder-modal.visible,
                .sp-folder-modal.closing,
                .sp-checkbox.is-animating:checked,
                .sp-checkbox.is-animating:checked::before {
                    animation: none !important;
                }

                .source-item.sp-spotlight-surface::before,
                .group-header.sp-spotlight-surface::before {
                    transition-property: opacity !important;
                }

                .sp-icon-button:hover,
                .sp-icon-button:active,
                .sp-button:hover,
                .sp-button:active,
                .source-item:hover,
                .source-item:active,
                .group-header:hover,
                .group-header:active,
                .sp-source-actions-button:hover,
                .sp-source-actions-button:active,
                .sp-add-subgroup-button:hover,
                .sp-add-subgroup-button:active,
                .sp-isolate-button:hover,
                .sp-isolate-button:active,
                .sp-edit-button:hover,
                .sp-edit-button:active,
                .sp-delete-button:hover,
                .sp-delete-button:active,
                .sp-folder-option:hover,
                .sp-folder-option:focus-visible,
                .sp-tag-option:hover,
                .sp-tag-option:focus-within,
                .sp-tag-row:hover,
                .sp-tag-row:focus-within,
                .sp-tag-row-button:hover,
                .sp-modal-cancel:hover,
                .sp-modal-cancel:active,
                .sp-empty-state,
                .group-container.drag-into > .group-children > .sp-empty-state {
                    transform: none !important;
                }

                .sp-toast,
                .sp-toast.show {
                    filter: none !important;
                    transform: translateX(-50%) !important;
                }
            }
        `;

    const globalOverlayStyleText = `
                    /* Google Symbols font + base rule for elements appended to
                       document.body (e.g. the multi-source drag ghost). The
                       Shadow DOM declaration in contentStyleText is unreachable
                       from elements outside the shadow root, so the glyph would
                       otherwise render as literal text or a fallback square. */
                    @font-face {
                        font-family: 'Google Symbols';
                        font-style: normal;
                        font-weight: 400;
                        src: url("${googleSymbolsFontUrl}") format('woff2');
                    }
                    .google-symbols {
                        font-family: 'Google Symbols';
                        font-weight: normal;
                        font-style: normal;
                        font-size: 18px;
                        line-height: 1;
                        letter-spacing: normal;
                        text-transform: none;
                        display: inline-block;
                        white-space: nowrap;
                        word-wrap: normal;
                        direction: ltr;
                        -webkit-font-feature-settings: 'liga';
                        -webkit-font-smoothing: antialiased;
                    }

                    /* --------- Global Apple HIG Glassmorphism Overrides --------- */
                    /* Note: Modifying Angular Material generic overlay/dialog structures */

                    /* 1. Popover Menus (More button floating menus) */
                    body .cdk-overlay-container .mat-mdc-menu-panel,
                    body .cdk-overlay-container .mat-menu-panel {
                        background-color: var(--sp-glass-bg-menu, rgba(255, 255, 255, 0.85)) !important;
                        backdrop-filter: blur(20px) saturate(150%) !important;
                        -webkit-backdrop-filter: blur(20px) saturate(150%) !important;
                        border-radius: 12px !important;
                        border: 1px solid var(--sp-glass-border, rgba(0, 0, 0, 0.1)) !important;
                        box-shadow: var(--sp-glass-shadow, 0 8px 32px rgba(0, 0, 0, 0.12)) !important;
                        overflow: hidden !important;
                    }
                    
                    /* Menu item hover effects inside the glass panel */
                    body .cdk-overlay-container .mat-mdc-menu-item:hover,
                    body .cdk-overlay-container .mat-menu-item:hover {
                        background-color: var(--sp-menu-item-hover-bg, rgba(128, 128, 128, 0.1)) !important;
                    }

                    /* 2. Dialogs / Modals (New Note, Rename, Delete Confirmation) */
                    body .cdk-overlay-container .mat-mdc-dialog-surface,
                    body .cdk-overlay-container .mat-dialog-container {
                        background-color: var(--sp-glass-bg-body, rgba(255, 255, 255, 0.75)) !important;
                        backdrop-filter: blur(24px) saturate(180%) !important;
                        -webkit-backdrop-filter: blur(24px) saturate(180%) !important;
                        border-radius: 16px !important;
                        border: 1px solid var(--sp-glass-border, rgba(0, 0, 0, 0.1)) !important;
                        box-shadow: var(--sp-glass-shadow, 0 8px 32px rgba(0, 0, 0, 0.12)) !important;
                    }

                    /* Respect system dark mode for global variables if not defined in shadow root */
                    @media (prefers-color-scheme: dark) {
                        body .cdk-overlay-container {
                            --sp-glass-bg-body: rgba(28, 28, 30, 0.85);
                            --sp-glass-bg-menu: rgba(44, 44, 46, 0.85);
                            --sp-glass-border: rgba(255, 255, 255, 0.15);
                            --sp-glass-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
                        }
                    }

                    /* multi-source drag ghost
                       The ghost element is appended to document.body during
                       multi-source drag, so it lives outside the Shadow DOM
                       and cannot read --sp-* tokens from :host. Values are
                       hardcoded to match the resolved light/dark tokens. */
                    .sp-drag-ghost {
                        position: fixed;
                        top: -9999px;
                        left: -9999px;
                        display: inline-flex;
                        align-items: center;
                        padding: 8px 12px;
                        border-radius: 999px;
                        background: #fff;
                        color: #1A1A1C;
                        border: 1px solid rgba(0, 0, 0, 0.15);
                        box-shadow: 0 10px 24px rgba(0, 0, 0, 0.08);
                        font-size: 13px;
                        pointer-events: none;
                        user-select: none;
                    }
                    .sp-drag-ghost-count {
                        font-weight: 600;
                        line-height: 1;
                    }
                    @media (prefers-color-scheme: dark) {
                        .sp-drag-ghost {
                            background: #1c1c1e;
                            color: #f5f5f7;
                            border-color: rgba(255, 255, 255, 0.2);
                            box-shadow: 0 12px 28px rgba(0, 0, 0, 0.32);
                        }
                    }
                `;

    globalThis.NSM_CONTENT_STYLE_TEXT = contentStyleText;
    globalThis.NSM_GLOBAL_OVERLAY_STYLE_TEXT = globalOverlayStyleText;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            contentStyleText,
            globalOverlayStyleText
        };
    }
})();
