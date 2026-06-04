/* ============================================================
   popup.js — extension popup controller (Step 13).
   - Loads/saves backend settings (base URL, API key, userId).
   - Toggles picker / recorder in the active tab (via background relay).
   - Shows the recorded steps (chrome.storage.local.ab_steps).
   - Sends the Flow to the backend via the background service worker.
   CSP-safe: external script, no inline handlers.
   ============================================================ */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    conn: $('conn'),
    baseUrl: $('baseUrl'), apiKey: $('apiKey'), userId: $('userId'),
    saveCfg: $('saveCfg'), checkCfg: $('checkCfg'),
    pick: $('pick'), record: $('record'),
    pickedBox: $('pickedBox'), pickedCss: $('pickedCss'), pickedXpath: $('pickedXpath'),
    addClick: $('addClick'), addExtract: $('addExtract'), copyCss: $('copyCss'),
    steps: $('steps'), stepCount: $('stepCount'),
    clearSteps: $('clearSteps'), sendFlow: $('sendFlow'), status: $('status')
  };

  var picking = false;
  var recording = false;
  var lastPick = null;

  function get(keys) {
    return new Promise(function (r) { chrome.storage.local.get(keys, r); });
  }
  function set(obj) {
    return new Promise(function (r) { chrome.storage.local.set(obj, r); });
  }
  function bg(msg) {
    return new Promise(function (r) {
      chrome.runtime.sendMessage(msg, function (resp) { void chrome.runtime.lastError; r(resp || { ok: false }); });
    });
  }
  function relay(message) { return bg({ type: 'AB_RELAY', message: message }); }

  function setStatus(text, kind) {
    els.status.textContent = text || '';
    els.status.className = 'status' + (kind ? ' ' + kind : '');
  }

  function stepLabel(s) {
    var p = s.params || {};
    if (s.action === 'goto') return 'goto ' + (p.url || '');
    if (s.action === 'click') return 'click ' + (p.selector || '');
    if (s.action === 'fill') return 'fill ' + (p.selector || '') + ' = ' + (p.text || '');
    if (s.action === 'press') return 'press ' + (p.text || '');
    if (s.action === 'extract') return 'extract ' + (p.selector || '') + ' -> ' + (p.name || '');
    return s.action + ' ' + JSON.stringify(p);
  }

  function renderSteps(arr) {
    arr = arr || [];
    els.stepCount.textContent = String(arr.length);
    if (!arr.length) {
      els.steps.innerHTML = '<li class="empty">No steps yet. Pick an element or start recording.</li>';
      return;
    }
    els.steps.innerHTML = '';
    arr.forEach(function (s) {
      var li = document.createElement('li');
      li.textContent = stepLabel(s);
      els.steps.appendChild(li);
    });
  }

  async function loadSteps() {
    var s = await get(['ab_steps']);
    renderSteps(s.ab_steps);
  }

  async function appendStep(step) {
    var s = await get(['ab_steps']);
    var arr = Array.isArray(s.ab_steps) ? s.ab_steps : [];
    arr.push(step);
    await set({ ab_steps: arr });
    renderSteps(arr);
  }

  // ---- settings --------------------------------------------------------
  async function loadSettings() {
    var s = await get(['ab_baseUrl', 'ab_apiKey', 'ab_userId', 'ab_picker', 'ab_recording']);
    els.baseUrl.value = s.ab_baseUrl || '';
    els.apiKey.value = s.ab_apiKey || '';
    els.userId.value = s.ab_userId || '0';
    picking = !!s.ab_picker;
    recording = !!s.ab_recording;
    syncToggleUi();
  }
  async function saveSettings() {
    await set({
      ab_baseUrl: els.baseUrl.value.trim(),
      ab_apiKey: els.apiKey.value,
      ab_userId: (els.userId.value.trim() || '0')
    });
    setStatus('Saved.', 'ok');
  }

  async function checkConn() {
    setStatus('Testing…', 'warn');
    var r = await bg({ type: 'AB_CHECK' });
    if (r && r.ok) {
      els.conn.textContent = '● online';
      els.conn.className = 'conn ok';
      setStatus('Connected.', 'ok');
    } else {
      els.conn.textContent = '● offline';
      els.conn.className = 'conn bad';
      setStatus('Connection failed: ' + ((r && (r.error || ('http_' + r.status))) || 'unknown'), 'bad');
    }
  }

  // ---- toggles ---------------------------------------------------------
  function syncToggleUi() {
    els.pick.classList.toggle('active', picking);
    els.pick.textContent = picking ? '🎯 Stop picking' : '🎯 Pick element';
    els.record.classList.toggle('active', recording);
    els.record.textContent = recording ? '⏹ Stop recording' : '⏺ Record';
  }

  async function togglePick() {
    picking = !picking;
    syncToggleUi();
    var r = await relay({ type: picking ? 'AB_PICK_START' : 'AB_PICK_STOP' });
    if (r && r.error === 'no_content_script') {
      setStatus('Open a normal web page (http/https), then try again.', 'warn');
      picking = false; syncToggleUi();
      await set({ ab_picker: false });
    } else {
      await set({ ab_picker: picking });
    }
  }

  async function toggleRecord() {
    recording = !recording;
    syncToggleUi();
    var r = await relay({ type: recording ? 'AB_REC_START' : 'AB_REC_STOP' });
    if (r && r.error === 'no_content_script') {
      setStatus('Open a normal web page (http/https), then try again.', 'warn');
      recording = false; syncToggleUi();
      await set({ ab_recording: false });
    } else {
      await set({ ab_recording: recording });
      if (recording) setStatus('Recording… interact with the page.', 'ok');
    }
  }

  function showPick(p) {
    lastPick = p;
    els.pickedBox.hidden = false;
    els.pickedCss.value = p.css || '';
    els.pickedXpath.value = p.xpath || '';
    setStatus('Picked <' + (p.tag || '?') + '>', 'ok');
  }

  function copyText(text) {
    try {
      navigator.clipboard.writeText(text);
      setStatus('Copied.', 'ok');
    } catch (e) { setStatus('Copy failed.', 'bad'); }
  }

  // ---- send ------------------------------------------------------------
  async function sendFlow() {
    var s = await get(['ab_steps']);
    var arr = Array.isArray(s.ab_steps) ? s.ab_steps : [];
    if (!arr.length) { setStatus('No steps to send.', 'warn'); return; }
    setStatus('Sending ' + arr.length + ' step(s)…', 'warn');
    var r = await bg({ type: 'AB_SEND_FLOW', payload: { steps: arr } });
    if (r && r.ok) {
      var jid = r.data && (r.data.jobId || r.data.id || (r.data.job && r.data.job.id));
      setStatus('Queued ✓' + (jid != null ? (' — Job ID: ' + jid) : ''), 'ok');
    } else {
      var err = r && (r.error || ('http_' + r.status));
      var detail = r && r.data && r.data.error ? (' — ' + r.data.error) : '';
      setStatus('Send failed: ' + (err || 'unknown') + detail, 'bad');
    }
  }

  // ---- messages from content/background --------------------------------
  chrome.runtime.onMessage.addListener(function (msg) {
    if (!msg || !msg.type) return;
    if (msg.type === 'AB_PICKED') {
      showPick(msg);
      // picking is one-shot for clarity: stop after a pick
      picking = false; syncToggleUi();
      set({ ab_picker: false });
      relay({ type: 'AB_PICK_STOP' });
    } else if (msg.type === 'AB_STEP_RECORDED') {
      loadSteps();
    }
  });

  // ---- wire up ---------------------------------------------------------
  els.saveCfg.addEventListener('click', saveSettings);
  els.checkCfg.addEventListener('click', checkConn);
  els.pick.addEventListener('click', togglePick);
  els.record.addEventListener('click', toggleRecord);
  els.addClick.addEventListener('click', function () {
    if (lastPick && lastPick.css) appendStep({ action: 'click', params: { selector: lastPick.css } });
  });
  els.addExtract.addEventListener('click', function () {
    if (lastPick && lastPick.css) appendStep({ action: 'extract', params: { selector: lastPick.css, name: 'value' } });
  });
  els.copyCss.addEventListener('click', function () {
    if (lastPick && lastPick.css) copyText(lastPick.css);
  });
  els.clearSteps.addEventListener('click', async function () {
    await set({ ab_steps: [], ab_last_url: '' });
    renderSteps([]);
    setStatus('Cleared.', 'ok');
  });
  els.sendFlow.addEventListener('click', sendFlow);

  // init
  loadSettings();
  loadSteps();
})();
