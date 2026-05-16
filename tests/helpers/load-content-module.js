function clearContentGlobals() {
    delete globalThis.NSM_CONTENT_CONFIG;
    delete globalThis.NSM_SOURCE_DESCRIPTOR_HELPERS;
    delete globalThis.NSM_CONTENT_STYLE_TEXT;
    delete globalThis.NSM_GLOBAL_OVERLAY_STYLE_TEXT;
    delete globalThis.NSM_CREATE_MANAGER_SHELL;
    delete globalThis.NSM_CREATE_CONTENT_PANEL_DOM;
    delete globalThis.NSM_CREATE_CONTENT_SOURCE_ACTIONS;
    delete globalThis.NSM_CREATE_CONTENT_TAGS;
    delete globalThis.NSM_CREATE_CONTENT_STATE_RECONCILE;
    delete globalThis.NSM_CREATE_CONTENT_DEVELOPER_LOGGER;
    delete globalThis.NSM_CREATE_CONTENT_RUNTIME_STATE;
    delete globalThis.NSM_CREATE_CONTENT_MESSAGE_ROUTER;
    delete globalThis.NSM_CREATE_CONTENT_PERSISTENCE;
    delete globalThis.NSM_CREATE_CONTENT_SOURCE_LIST_SCAN;
    delete globalThis.NSM_CREATE_CONTENT_NATIVE_LABEL_SCAN;
    delete globalThis.NSM_CREATE_CONTENT_NATIVE_LABEL_IMPORT;
    delete globalThis.NSM_CREATE_CONTENT_NATIVE_LABEL_IMPORT_MODAL;
    delete globalThis.NSM_CREATE_CONTENT_MODALS;
    delete globalThis.NSM_CREATE_CONTENT_RENDER;
    delete globalThis.NSM_CREATE_CONTENT_VIEW_STATE;
    delete globalThis.NSM_CREATE_CONTENT_TREE_INTERACTIONS;
    delete globalThis.NSM_CREATE_CONTENT_SOURCE_SYNC;
}

function loadContentModule() {
    clearContentGlobals();
    require('../../src/content/content-config.js');
    require('../../src/content/source-descriptor-helpers.js');
    require('../../src/content/content-style-text.js');
    require('../../src/content/content-template.js');
    require('../../src/content/content-panel-dom.js');
    require('../../src/content/content-source-actions.js');
    require('../../src/content/content-tags.js');
    require('../../src/content/content-state-reconcile.js');
    require('../../src/content/content-developer-logger.js');
    require('../../src/content/content-runtime-state.js');
    require('../../src/content/content-message-router.js');
    require('../../src/content/content-persistence.js');
    require('../../src/content/content-source-list-scan.js');
    require('../../src/content/content-native-label-scan.js');
    require('../../src/content/content-native-label-import.js');
    require('../../src/content/content-native-label-import-modal.js');
    require('../../src/content/content-modals.js');
    require('../../src/content/content-render.js');
    require('../../src/content/content-view-state.js');
    require('../../src/content/content-tree-interactions.js');
    require('../../src/content/content-source-sync.js');
    return require('../../src/content/index.js');
}

module.exports = loadContentModule;
