// =====================================================================
// actions.js — Shared ACTION catalog (Step 11)
// ---------------------------------------------------------------------
// Single source of truth for both the linear form builder (views.js) and
// the node-based visual editor (flow-editor.js). Previously the catalog
// was duplicated in both files; it now lives here as window.ACTION_CATALOG.
//
// Field format: { k, label, type, ph?, options? }
//   - k:        param key sent to the backend as params[k]
//   - label:    i18n key (e.g. 'p.url')
//   - type:     'text' | 'number' | 'select'
//   - ph:       placeholder (text/number only)
//   - options:  array of option values (select only)
//
// Each backend action ({ action, params }) must be implemented in
// src/pipeline.ts. Loaded BEFORE i18n/api/views/flow-editor in index.html.
// LF line endings (public/** convention).
// =====================================================================
(function () {
  'use strict';

  var ACTIONS = [
    // ---- Navigation & timing -----------------------------------------
    { id: 'goto', icon: '🌐', fields: [
      { k: 'url', label: 'p.url', type: 'text', ph: 'https://example.com' },
    ] },
    { id: 'wait', icon: '⏳', fields: [
      { k: 'ms', label: 'p.ms', type: 'number', ph: '1000' },
      { k: 'selector', label: 'p.selector', type: 'text', ph: '(optional) #ready' },
    ] },

    // ---- Mouse / interaction -----------------------------------------
    { id: 'click', icon: '🖱️', fields: [
      { k: 'selector', label: 'p.selector', type: 'text', ph: 'button.submit' },
    ] },
    { id: 'hover', icon: '👆', fields: [
      { k: 'selector', label: 'p.selector', type: 'text', ph: '.menu' },
    ] },
    { id: 'scroll', icon: '🧭', fields: [
      { k: 'direction', label: 'p.direction', type: 'select', options: ['bottom', 'top'] },
    ] },

    // ---- Forms / keyboard --------------------------------------------
    { id: 'fill', icon: '✏️', fields: [
      { k: 'selector', label: 'p.selector', type: 'text', ph: 'input[name=q]' },
      { k: 'text', label: 'p.text', type: 'text', ph: 'hello' },
    ] },
    { id: 'type', icon: '⌨️', fields: [
      { k: 'selector', label: 'p.selector', type: 'text', ph: 'input[name=q]' },
      { k: 'text', label: 'p.text', type: 'text', ph: 'hello' },
    ] },
    { id: 'press', icon: '↩️', fields: [
      { k: 'text', label: 'p.key', type: 'text', ph: 'Enter' },
    ] },
    { id: 'select', icon: '🔽', fields: [
      { k: 'selector', label: 'p.selector', type: 'text', ph: 'select#country' },
      { k: 'value', label: 'p.value', type: 'text', ph: 'IR' },
    ] },
    { id: 'upload', icon: '📎', fields: [
      { k: 'selector', label: 'p.selector', type: 'text', ph: 'input[type=file]' },
      { k: 'path', label: 'p.value', type: 'text', ph: 'uploads/file.pdf' },
    ] },

    // ---- Data extraction & export ------------------------------------
    { id: 'extract', icon: '📤', fields: [
      { k: 'selector', label: 'p.selector', type: 'text', ph: '.price' },
      { k: 'name', label: 'p.name', type: 'text', ph: 'price' },
    ] },
    { id: 'export-data', icon: '💾', fields: [
      { k: 'format', label: 'p.format', type: 'select', options: ['json', 'csv'] },
      { k: 'from', label: 'p.from', type: 'text', ph: '(optional) variable name' },
      { k: 'filename', label: 'p.filename', type: 'text', ph: 'export' },
    ] },
    { id: 'screenshot', icon: '📸', fields: [] },

    // ---- Variables (Automa-style transforms) -------------------------
    { id: 'variable', icon: '🔢', fields: [
      { k: 'op', label: 'p.op', type: 'select', options: ['set', 'regex', 'replace', 'slice', 'split', 'join', 'sort'] },
      { k: 'name', label: 'p.name', type: 'text', ph: 'result' },
      { k: 'from', label: 'p.from', type: 'text', ph: '(optional) source variable' },
      { k: 'value', label: 'p.value', type: 'text', ph: 'literal value (if no "from")' },
      { k: 'pattern', label: 'p.pattern', type: 'text', ph: 'regex / replace pattern' },
      { k: 'flags', label: 'p.flags', type: 'text', ph: 'g i m' },
      { k: 'replacement', label: 'p.replacement', type: 'text', ph: 'replace op' },
      { k: 'separator', label: 'p.separator', type: 'text', ph: 'split / join' },
      { k: 'start', label: 'p.start', type: 'number', ph: 'slice start' },
      { k: 'end', label: 'p.end', type: 'number', ph: 'slice end' },
      { k: 'numeric', label: 'p.numeric', type: 'select', options: ['', 'true', 'false'] },
      { k: 'desc', label: 'p.desc', type: 'select', options: ['', 'true', 'false'] },
    ] },

    // ---- Cookies & clipboard -----------------------------------------
    { id: 'cookie', icon: '🍪', fields: [
      { k: 'op', label: 'p.op', type: 'select', options: ['getAll', 'get', 'set', 'clear'] },
      { k: 'name', label: 'p.name', type: 'text', ph: 'session_id' },
      { k: 'value', label: 'p.value', type: 'text', ph: 'set op only' },
      { k: 'domain', label: 'p.domain', type: 'text', ph: '(optional) .example.com' },
      { k: 'expires', label: 'p.expires', type: 'number', ph: '(optional) unix ts' },
    ] },
    { id: 'clipboard', icon: '📋', fields: [
      { k: 'action', label: 'p.op', type: 'select', options: ['get', 'set', 'copy', 'paste'] },
      { k: 'text', label: 'p.text', type: 'text', ph: 'set op' },
      { k: 'selector', label: 'p.selector', type: 'text', ph: 'copy/paste op' },
    ] },

    // ---- Notification & logging --------------------------------------
    { id: 'notification', icon: '🔔', fields: [
      { k: 'title', label: 'p.title', type: 'text', ph: 'Done' },
      { k: 'message', label: 'p.message', type: 'text', ph: 'workflow finished' },
      { k: 'level', label: 'p.level', type: 'select', options: ['info', 'success', 'warn', 'error'] },
    ] },
    { id: 'log', icon: '📝', fields: [
      { k: 'message', label: 'p.message', type: 'text', ph: 'checkpoint' },
    ] },
  ];

  function actionById(id) {
    for (var i = 0; i < ACTIONS.length; i++) {
      if (ACTIONS[i].id === id) return ACTIONS[i];
    }
    return ACTIONS[0];
  }

  // Expose globally (CSP-safe, no modules).
  window.ACTION_CATALOG = {
    ACTIONS: ACTIONS,
    actionById: actionById,
    ids: function () { return ACTIONS.map(function (a) { return a.id; }); },
  };
})();
