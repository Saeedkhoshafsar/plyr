/* ============================================================
   background.js — service worker (Step 13).
   - Performs the secure POST /run to the backend. Doing the fetch
     here (extension-privileged, with host_permissions) avoids the
     page-context CORS restrictions a content script would hit.
   - Relays a few control messages from the popup to the active tab's
     content script (picker/recorder toggles).

   Settings (backend base URL, API key, userId) live in
   chrome.storage.local: ab_baseUrl, ab_apiKey, ab_userId.
   API key is never logged.
   ============================================================ */
'use strict';

function getSettings() {
  return new Promise(function (resolve) {
    chrome.storage.local.get(['ab_baseUrl', 'ab_apiKey', 'ab_userId'], function (s) {
      resolve({
        baseUrl: (s && s.ab_baseUrl) || '',
        apiKey: (s && s.ab_apiKey) || '',
        userId: (s && s.ab_userId) || '0'
      });
    });
  });
}

function normalizeBase(url) {
  var u = String(url || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
  return u.replace(/\/+$/, '');
}

// Send the recorded steps to the backend as a Flow.
async function sendFlow(payload) {
  var cfg = await getSettings();
  var base = normalizeBase(cfg.baseUrl);
  if (!base) return { ok: false, error: 'no_base_url' };
  if (!cfg.apiKey) return { ok: false, error: 'no_api_key' };

  var steps = Array.isArray(payload && payload.steps) ? payload.steps : [];
  if (!steps.length) return { ok: false, error: 'no_steps' };

  var body = {
    userId: cfg.userId || '0',
    steps: steps,
    headless: true
  };
  if (payload && payload.webhookUrl) body.webhookUrl = payload.webhookUrl;

  try {
    var res = await fetch(base + '/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cfg.apiKey
      },
      body: JSON.stringify(body)
    });
    var text = await res.text();
    var data;
    try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
    if (!res.ok) {
      return { ok: false, error: 'http_' + res.status, status: res.status, data: data };
    }
    return { ok: true, status: res.status, data: data };
  } catch (e) {
    return { ok: false, error: 'network', message: String(e && e.message || e) };
  }
}

// Validate the API key / connectivity via GET /me.
async function checkConnection() {
  var cfg = await getSettings();
  var base = normalizeBase(cfg.baseUrl);
  if (!base) return { ok: false, error: 'no_base_url' };
  if (!cfg.apiKey) return { ok: false, error: 'no_api_key' };
  try {
    var res = await fetch(base + '/me', {
      method: 'GET',
      headers: { 'x-api-key': cfg.apiKey }
    });
    var data = null;
    try { data = await res.json(); } catch (e) { /* ignore */ }
    return { ok: res.ok, status: res.status, data: data };
  } catch (e) {
    return { ok: false, error: 'network', message: String(e && e.message || e) };
  }
}

// Relay a control message to the active tab's content script.
async function relayToActiveTab(message) {
  return new Promise(function (resolve) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var tab = tabs && tabs[0];
      if (!tab || tab.id == null) { resolve({ ok: false, error: 'no_active_tab' }); return; }
      chrome.tabs.sendMessage(tab.id, message, function (resp) {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: 'no_content_script' });
        } else {
          resolve(resp || { ok: true });
        }
      });
    });
  });
}

chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
  if (!msg || !msg.type) return;
  switch (msg.type) {
    case 'AB_SEND_FLOW':
      sendFlow(msg.payload).then(sendResponse);
      return true; // async
    case 'AB_CHECK':
      checkConnection().then(sendResponse);
      return true; // async
    case 'AB_RELAY':
      relayToActiveTab(msg.message).then(sendResponse);
      return true; // async
    default:
      return false;
  }
});
