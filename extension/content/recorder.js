/* ============================================================
   recorder.js — content script (Step 13).
   Two cooperating features on the real user page:
     1) Element Picker: hover-highlight, click reports a CSS/XPath
        selector to the popup (without triggering the page's own
        click handler).
     2) Action recorder: while recording, observes the user's real
        clicks, text input (change), Enter key, and navigations,
        and turns them into backend "steps" ({action, params}).

   State (recording on/off, picker on/off) is kept in chrome.storage
   so it survives navigations (the content script re-injects per page
   load). Recorded steps are appended to chrome.storage.local.ab_steps.

   Messages handled (from popup/background):
     { type: 'AB_PICK_START' | 'AB_PICK_STOP'
            | 'AB_REC_START'  | 'AB_REC_STOP'
            | 'AB_PING' }
   Messages sent:
     { type: 'AB_PICKED', css, xpath, tag, text }
     { type: 'AB_STEP_RECORDED', step }
   ============================================================ */
(function () {
  'use strict';
  if (window.__abRecorderLoaded) return;
  window.__abRecorderLoaded = true;

  // selector.js is injected alongside; guard if missing.
  function sel() { return window.ABSelector || { cssPath: function () { return ''; }, xPath: function () { return ''; } }; }

  var pickerOn = false;
  var recordingOn = false;
  var hoverBox = null;
  var hoverEl = null;
  // Debounce text recording per element so we record the final value once.
  var pendingInput = new WeakMap();

  // ---- storage helpers -------------------------------------------------
  function getState(cb) {
    try {
      chrome.storage.local.get(['ab_picker', 'ab_recording'], function (s) {
        cb(!!(s && s.ab_picker), !!(s && s.ab_recording));
      });
    } catch (e) { cb(false, false); }
  }
  function appendStep(step) {
    try {
      chrome.storage.local.get(['ab_steps'], function (s) {
        var arr = (s && Array.isArray(s.ab_steps)) ? s.ab_steps : [];
        arr.push(step);
        chrome.storage.local.set({ ab_steps: arr });
      });
    } catch (e) { /* ignore */ }
    safeSend({ type: 'AB_STEP_RECORDED', step: step });
  }
  function safeSend(msg) {
    try { chrome.runtime.sendMessage(msg, function () { void chrome.runtime.lastError; }); }
    catch (e) { /* popup may be closed; ignore */ }
  }

  // ---- picker overlay --------------------------------------------------
  function ensureBox() {
    if (hoverBox) return hoverBox;
    hoverBox = document.createElement('div');
    hoverBox.style.cssText =
      'position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #4f8cff;' +
      'background:rgba(79,140,255,.15);box-shadow:0 0 0 1px #fff;transition:all .03s;';
    (document.documentElement || document.body).appendChild(hoverBox);
    return hoverBox;
  }
  function removeBox() {
    if (hoverBox && hoverBox.parentNode) hoverBox.parentNode.removeChild(hoverBox);
    hoverBox = null; hoverEl = null;
  }

  function onPickMove(e) {
    var el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === hoverBox) return;
    hoverEl = el;
    var r = el.getBoundingClientRect();
    var b = ensureBox();
    b.style.left = r.left + 'px'; b.style.top = r.top + 'px';
    b.style.width = r.width + 'px'; b.style.height = r.height + 'px';
  }
  function onPickClick(e) {
    e.preventDefault(); e.stopPropagation();
    var el = hoverEl || document.elementFromPoint(e.clientX, e.clientY);
    if (!el) return;
    var s = sel();
    safeSend({
      type: 'AB_PICKED',
      css: s.cssPath(el),
      xpath: s.xPath(el),
      tag: el.nodeName.toLowerCase(),
      text: (el.textContent || '').trim().slice(0, 80)
    });
  }

  function startPicker() {
    if (pickerOn) return;
    pickerOn = true;
    document.addEventListener('mousemove', onPickMove, true);
    document.addEventListener('click', onPickClick, true);
  }
  function stopPicker() {
    pickerOn = false;
    document.removeEventListener('mousemove', onPickMove, true);
    document.removeEventListener('click', onPickClick, true);
    removeBox();
  }

  // ---- recorder --------------------------------------------------------
  function isTextInput(el) {
    if (!el) return false;
    var tag = el.nodeName.toLowerCase();
    if (tag === 'textarea') return true;
    if (el.isContentEditable) return true;
    if (tag === 'input') {
      var t = (el.getAttribute('type') || 'text').toLowerCase();
      return ['text', 'search', 'email', 'url', 'tel', 'password', 'number', ''].indexOf(t) >= 0;
    }
    return false;
  }

  function onRecClick(e) {
    if (pickerOn) return; // picker has priority and suppresses the real click
    var el = e.target;
    if (!el || el.nodeType !== 1) return;
    // For text inputs, the value is captured on change; skip click noise.
    if (isTextInput(el)) return;
    var s = sel();
    appendStep({ action: 'click', params: { selector: s.cssPath(el) } });
  }

  function onRecChange(e) {
    var el = e.target;
    if (!el || !isTextInput(el)) return;
    var s = sel();
    var val = el.isContentEditable ? (el.textContent || '') : (el.value != null ? el.value : '');
    appendStep({ action: 'fill', params: { selector: s.cssPath(el), text: String(val) } });
  }

  function onRecKeydown(e) {
    if (e.key !== 'Enter') return;
    var el = e.target;
    if (!el || el.nodeType !== 1) return;
    // record any pending text first so order is correct
    if (isTextInput(el)) onRecChange(e);
    appendStep({ action: 'press', params: { text: 'Enter' } });
  }

  function startRecorder() {
    if (recordingOn) return;
    recordingOn = true;
    document.addEventListener('click', onRecClick, true);
    document.addEventListener('change', onRecChange, true);
    document.addEventListener('keydown', onRecKeydown, true);
  }
  function stopRecorder() {
    recordingOn = false;
    document.removeEventListener('click', onRecClick, true);
    document.removeEventListener('change', onRecChange, true);
    document.removeEventListener('keydown', onRecKeydown, true);
  }

  // ---- navigation recording -------------------------------------------
  // On a fresh page load while recording, record a goto for the URL
  // (deduped against the most recent step).
  function maybeRecordNavigation() {
    getState(function (picker, recording) {
      if (!recording) return;
      try {
        chrome.storage.local.get(['ab_steps', 'ab_last_url'], function (s) {
          var url = location.href;
          if (s && s.ab_last_url === url) return;
          chrome.storage.local.set({ ab_last_url: url });
          var arr = (s && Array.isArray(s.ab_steps)) ? s.ab_steps : [];
          var last = arr[arr.length - 1];
          if (last && last.action === 'goto' && last.params && last.params.url === url) return;
          appendStep({ action: 'goto', params: { url: url } });
        });
      } catch (e) { /* ignore */ }
    });
  }

  // ---- message handling ------------------------------------------------
  chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case 'AB_PICK_START': chrome.storage.local.set({ ab_picker: true }); startPicker(); break;
      case 'AB_PICK_STOP':  chrome.storage.local.set({ ab_picker: false }); stopPicker(); break;
      case 'AB_REC_START':  chrome.storage.local.set({ ab_recording: true }); startRecorder(); maybeRecordNavigation(); break;
      case 'AB_REC_STOP':   chrome.storage.local.set({ ab_recording: false }); stopRecorder(); break;
      case 'AB_PING':       break;
    }
    if (sendResponse) sendResponse({ ok: true, picker: pickerOn, recording: recordingOn });
    return true;
  });

  // React to state changes from other tabs/popup.
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local') return;
    if (changes.ab_picker) { changes.ab_picker.newValue ? startPicker() : stopPicker(); }
    if (changes.ab_recording) { changes.ab_recording.newValue ? startRecorder() : stopRecorder(); }
  });

  // On load, restore active state (picker/recording survive navigation).
  getState(function (picker, recording) {
    if (picker) startPicker();
    if (recording) { startRecorder(); maybeRecordNavigation(); }
  });
})();
