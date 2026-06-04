/* ============================================
   Views — Run / Jobs / Job detail / Quota / Schedules / Admin.
   Step 8: build/run/monitor jobs + quota + schedules + admin.
   Exposes window.Views.{ render, stopAll }.
   ============================================ */
(function () {
  'use strict';

  var API = window.API;
  // AppUtil is defined by app.js, which loads AFTER this file. Resolve it
  // lazily at call time (never capture it at script-load time, or it'd be undefined).
  function U() { return window.AppUtil; }

  // active interval handles per view, cleared on navigation
  var timers = [];
  function track(id) { timers.push(id); return id; }
  function stopAll() {
    timers.forEach(function (id) { clearInterval(id); });
    timers = [];
    // tear down the visual editor's window-level listeners when leaving the view
    if (window.FlowEditor && typeof window.FlowEditor.unmount === 'function') {
      try { window.FlowEditor.unmount(); } catch (e) { /* noop */ }
    }
    // close any active live (WebSocket/SSE) connection when leaving the view
    if (window.LiveView && typeof window.LiveView.stop === 'function') {
      try { window.LiveView.stop(); } catch (e) { /* noop */ }
    }
  }

  function t(k) { return U().t(k); }
  function esc(s) { return U().esc(s); }

  function effectiveUserId() {
    var uid = API.getUserId();
    // env_root (admin key) is not a real automation user; default to "0".
    if (!uid || uid === 'env_root') return '0';
    return uid;
  }

  // ---------------------------------------------
  // Action catalog for the flow builder.
  // Each action lists the param fields it needs.
  // ---------------------------------------------
  // Shared catalog (public/js/actions.js → window.ACTION_CATALOG).
  // Falls back to a minimal inline list if the catalog failed to load.
  var CAT = window.ACTION_CATALOG || {
    ACTIONS: [{ id: 'goto', fields: [{ k: 'url', label: 'p.url', type: 'text', ph: 'https://example.com' }] }],
    actionById: function (id) { return this.ACTIONS[0]; },
  };
  var ACTIONS = CAT.ACTIONS;
  function actionById(id) { return CAT.actionById(id); }

  // =============================================
  // RUN / FLOW BUILDER
  // =============================================
  // in-memory steps for the builder: [{ action, params:{} }]
  var builderSteps = [];

  function renderRun(root) {
    if (builderSteps.length === 0) {
      builderSteps = [{ action: 'goto', params: { url: 'https://example.com' } }];
    }
    var uid = effectiveUserId();

    root.innerHTML =
      '<div class="card">' +
        '<h3 class="card-title">▶️ ' + t('run.title') + '</h3>' +
        '<div class="form-row">' +
          '<label class="field">' +
            '<span class="field-label">' + t('run.userId') + '</span>' +
            '<input id="run-userid" class="field-input" value="' + esc(uid) + '" />' +
            '<span class="field-hint">' + t('run.userIdHint') + '</span>' +
          '</label>' +
          '<label class="field">' +
            '<span class="field-label">' + t('run.webhook') + '</span>' +
            '<input id="run-webhook" class="field-input" placeholder="https://..." />' +
          '</label>' +
        '</div>' +
        '<label class="checkbox-field" style="margin-bottom:16px">' +
          '<input type="checkbox" id="run-headless" checked /> <span>' + t('run.headless') + '</span>' +
        '</label>' +

        '<div class="toolbar">' +
          '<strong>' + t('run.steps') + '</strong>' +
          '<span class="spacer"></span>' +
          '<button class="btn btn-ghost btn-sm" id="run-example">' + t('run.loadExample') + '</button>' +
          '<button class="btn btn-ghost btn-sm" id="run-clear">' + t('run.clearAll') + '</button>' +
          '<button class="btn btn-sm" id="run-add">+ ' + t('run.addStep') + '</button>' +
        '</div>' +
        '<div class="steps-list" id="steps-list"></div>' +

        '<div class="toolbar" style="margin-top:6px">' +
          '<button class="btn btn-primary" id="run-submit">' + t('run.submit') + '</button>' +
        '</div>' +
        '<div id="run-result"></div>' +
      '</div>';

    renderStepsList(root);

    root.querySelector('#run-add').addEventListener('click', function () {
      builderSteps.push({ action: 'goto', params: {} });
      renderStepsList(root);
    });
    root.querySelector('#run-clear').addEventListener('click', function () {
      builderSteps = [];
      renderStepsList(root);
    });
    root.querySelector('#run-example').addEventListener('click', function () {
      builderSteps = [
        { action: 'goto', params: { url: 'https://example.com' } },
        { action: 'wait', params: { ms: '1000' } },
        { action: 'extract', params: { selector: 'h1', name: 'title' } },
        { action: 'screenshot', params: {} },
      ];
      renderStepsList(root);
    });
    root.querySelector('#run-submit').addEventListener('click', function () { submitFlow(root); });
  }

  function renderStepsList(root) {
    var list = root.querySelector('#steps-list');
    if (!list) return;
    if (builderSteps.length === 0) {
      list.innerHTML = '<div class="placeholder">' + t('run.noSteps') + '</div>';
      return;
    }
    var html = '';
    builderSteps.forEach(function (step, idx) {
      var act = actionById(step.action);
      var opts = ACTIONS.map(function (a) {
        return '<option value="' + a.id + '"' + (a.id === step.action ? ' selected' : '') + '>' + a.id + '</option>';
      }).join('');

      var params = act.fields.map(function (f) {
        var val = step.params[f.k] != null ? String(step.params[f.k]) : '';
        if (f.type === 'select') {
          var o = f.options.map(function (op) {
            return '<option value="' + op + '"' + (op === val ? ' selected' : '') + '>' + op + '</option>';
          }).join('');
          return '<label class="field"><span class="field-label">' + t(f.label) + '</span>' +
            '<select class="field-input" data-step="' + idx + '" data-key="' + f.k + '">' + o + '</select></label>';
        }
        return '<label class="field"><span class="field-label">' + t(f.label) + '</span>' +
          '<input class="field-input" type="' + (f.type === 'number' ? 'number' : 'text') + '" ' +
          'data-step="' + idx + '" data-key="' + f.k + '" value="' + esc(val) + '" ' +
          'placeholder="' + esc(f.ph || '') + '" /></label>';
      }).join('');

      html +=
        '<div class="step-item">' +
          '<div class="step-head">' +
            '<span class="step-index">' + (idx + 1) + '</span>' +
            '<select class="field-input" data-action="' + idx + '">' + opts + '</select>' +
            '<span class="spacer"></span>' +
            '<button class="icon-btn" data-up="' + idx + '" title="' + t('run.moveUp') + '">↑</button>' +
            '<button class="icon-btn" data-down="' + idx + '" title="' + t('run.moveDown') + '">↓</button>' +
            '<button class="icon-btn" data-del="' + idx + '" title="' + t('run.removeStep') + '">🗑️</button>' +
          '</div>' +
          (params ? '<div class="step-params">' + params + '</div>' : '') +
        '</div>';
    });
    list.innerHTML = html;

    // action change
    list.querySelectorAll('select[data-action]').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var i = parseInt(sel.getAttribute('data-action'), 10);
        builderSteps[i].action = sel.value;
        builderSteps[i].params = {};
        renderStepsList(root);
      });
    });
    // param inputs
    list.querySelectorAll('[data-step]').forEach(function (inp) {
      inp.addEventListener('input', function () {
        var i = parseInt(inp.getAttribute('data-step'), 10);
        builderSteps[i].params[inp.getAttribute('data-key')] = inp.value;
      });
      inp.addEventListener('change', function () {
        var i = parseInt(inp.getAttribute('data-step'), 10);
        builderSteps[i].params[inp.getAttribute('data-key')] = inp.value;
      });
    });
    // controls
    list.querySelectorAll('[data-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        builderSteps.splice(parseInt(b.getAttribute('data-del'), 10), 1);
        renderStepsList(root);
      });
    });
    list.querySelectorAll('[data-up]').forEach(function (b) {
      b.addEventListener('click', function () {
        var i = parseInt(b.getAttribute('data-up'), 10);
        if (i > 0) { var s = builderSteps.splice(i, 1)[0]; builderSteps.splice(i - 1, 0, s); renderStepsList(root); }
      });
    });
    list.querySelectorAll('[data-down]').forEach(function (b) {
      b.addEventListener('click', function () {
        var i = parseInt(b.getAttribute('data-down'), 10);
        if (i < builderSteps.length - 1) { var s = builderSteps.splice(i, 1)[0]; builderSteps.splice(i + 1, 0, s); renderStepsList(root); }
      });
    });
  }

  // Convert builder steps -> API step format, coercing numbers.
  function buildPayloadSteps() {
    return builderSteps.map(function (s) {
      var params = {};
      var act = actionById(s.action);
      act.fields.forEach(function (f) {
        var v = s.params[f.k];
        if (v === undefined || v === '') return;
        if (f.type === 'number') {
          var n = parseInt(v, 10);
          if (!isNaN(n)) params[f.k] = n;
        } else {
          params[f.k] = v;
        }
      });
      return { action: s.action, params: params };
    });
  }

  function submitFlow(root) {
    var uid = (root.querySelector('#run-userid').value || '').trim();
    var webhook = (root.querySelector('#run-webhook').value || '').trim();
    var headless = root.querySelector('#run-headless').checked;
    var resultEl = root.querySelector('#run-result');

    if (!uid) { U().toast(t('run.needUserId'), 'error'); return; }
    if (builderSteps.length === 0) { U().toast(t('run.needStep'), 'error'); return; }

    var payload = { userId: uid, steps: buildPayloadSteps(), headless: headless };
    if (webhook) payload.webhookUrl = webhook;

    var btn = root.querySelector('#run-submit');
    btn.disabled = true;
    btn.textContent = t('run.submitting');
    resultEl.innerHTML = '';

    API.runFlow(payload)
      .then(function (data) {
        resultEl.innerHTML =
          '<div class="result-banner ok">✅ ' + t('run.queued') +
          ' &nbsp; ' + t('run.jobId') + ': <code>' + esc(data.jobId) + '</code> ' +
          '<button class="btn btn-ghost btn-sm" id="goto-job" data-job="' + esc(data.jobId) +
          '">' + t('run.viewJob') + '</button></div>';
        var g = resultEl.querySelector('#goto-job');
        if (g) g.addEventListener('click', function () {
          location.hash = '#/jobs?job=' + encodeURIComponent(data.jobId) + '&user=' + encodeURIComponent(uid);
        });
      })
      .catch(function (err) {
        resultEl.innerHTML = '<div class="result-banner err">⚠️ ' + esc(err.message) + '</div>';
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = t('run.submit');
      });
  }

  // =============================================
  // JOBS LIST + DETAIL
  // =============================================
  function stateBadge(state) {
    var key = 'state.' + (state || 'unknown');
    var cls = 'state-' + (state || 'unknown');
    return '<span class="state-badge ' + cls + '">' + t(key) + '</span>';
  }
  function fmtTime(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString(U().lang() === 'fa' ? 'fa-IR' : 'en-US'); }
    catch (e) { return iso; }
  }

  function parseHashQuery() {
    var h = location.hash || '';
    var q = h.indexOf('?') !== -1 ? h.substring(h.indexOf('?') + 1) : '';
    var out = {};
    q.split('&').forEach(function (pair) {
      if (!pair) return;
      var kv = pair.split('=');
      out[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
    });
    return out;
  }

  function renderJobs(root) {
    var qp = parseHashQuery();
    if (qp.job) { renderJobDetail(root, qp.user || effectiveUserId(), qp.job); return; }

    var uid = effectiveUserId();
    root.innerHTML =
      '<div class="card">' +
        '<div class="toolbar">' +
          '<h3 class="card-title" style="margin:0">🗂️ ' + t('jobs.title') + '</h3>' +
          '<span class="spacer"></span>' +
          '<input id="jobs-uid" class="field-input" style="max-width:160px" value="' + esc(uid) + '" />' +
          '<button class="btn btn-ghost btn-sm" id="jobs-refresh">' + t('jobs.refresh') + '</button>' +
        '</div>' +
        '<div id="jobs-body"><div class="placeholder"><span class="spinner"></span> ' + t('common.loading') + '</div></div>' +
      '</div>';

    function load() {
      var u = (root.querySelector('#jobs-uid').value || '').trim() || uid;
      var body = root.querySelector('#jobs-body');
      API.listJobs(u, 50)
        .then(function (data) {
          var jobs = data.jobs || [];
          if (jobs.length === 0) {
            body.innerHTML = '<div class="placeholder">' + t('jobs.empty') + '</div>';
            return;
          }
          var rows = jobs.map(function (j) {
            return '<tr>' +
              '<td class="mono">' + esc(j.jobId) + '</td>' +
              '<td>' + stateBadge(j.state) + '</td>' +
              '<td>' + esc(fmtTime(j.timestamp)) + '</td>' +
              '<td><div class="row-actions">' +
                '<button class="btn btn-ghost btn-sm" data-view="' + esc(j.jobId) + '">' + t('jobs.view') + '</button>' +
                (['waiting', 'delayed', 'active'].indexOf(j.state) !== -1 ?
                  '<button class="btn btn-ghost btn-sm" data-cancel="' + esc(j.jobId) + '">' + t('jobs.cancel') + '</button>' : '') +
              '</div></td>' +
            '</tr>';
          }).join('');
          body.innerHTML =
            '<div class="table-wrap"><table class="data"><thead><tr>' +
            '<th>' + t('jobs.id') + '</th><th>' + t('jobs.state') + '</th><th>' + t('jobs.time') + '</th><th>' + t('jobs.actions') + '</th>' +
            '</tr></thead><tbody>' + rows + '</tbody></table></div>';

          body.querySelectorAll('[data-view]').forEach(function (b) {
            b.addEventListener('click', function () {
              location.hash = '#/jobs?job=' + encodeURIComponent(b.getAttribute('data-view')) + '&user=' + encodeURIComponent(u);
            });
          });
          body.querySelectorAll('[data-cancel]').forEach(function (b) {
            b.addEventListener('click', function () {
              API.cancelJob(u, b.getAttribute('data-cancel'))
                .then(function () { U().toast(t('jobs.cancelled'), 'success'); load(); })
                .catch(function (err) { U().toast(err.message, 'error'); });
            });
          });
        })
        .catch(function (err) {
          body.innerHTML = '<div class="placeholder">⚠️ ' + esc(err.message) + '</div>';
        });
    }

    root.querySelector('#jobs-refresh').addEventListener('click', load);
    load();
    track(setInterval(load, 8000));
  }

  function renderJobDetail(root, userId, jobId) {
    root.innerHTML =
      '<div class="card">' +
        '<div class="toolbar">' +
          '<h3 class="card-title" style="margin:0">📄 ' + t('jobs.detail') + '</h3>' +
          '<span class="spacer"></span>' +
          '<button class="btn btn-ghost btn-sm" id="job-back">← ' + t('jobs.back') + '</button>' +
        '</div>' +
        '<div id="job-body"><div class="placeholder"><span class="spinner"></span> ' + t('common.loading') + '</div></div>' +
      '</div>';

    root.querySelector('#job-back').addEventListener('click', function () {
      location.hash = '#/jobs';
    });

    function load() {
      var body = root.querySelector('#job-body');
      API.getJob(userId, jobId)
        .then(function (data) {
          var state = data.state || (data.success === false ? 'failed' : 'completed');
          var live = state === 'active';
          var outputs = data.stepOutputs || data.outputs || [];

          var meta =
            '<dl class="kv">' +
              '<dt>' + t('run.jobId') + '</dt><dd class="mono">' + esc(jobId) + '</dd>' +
              '<dt>' + t('jobs.state') + '</dt><dd>' + stateBadge(state) + '</dd>' +
              (data.progress != null ? '<dt>' + t('jobs.progress') + '</dt><dd>' + esc(data.progress) + '%</dd>' : '') +
              (data.durationMs != null ? '<dt>' + t('jobs.duration') + '</dt><dd>' + (Math.round(data.durationMs / 100) / 10) + 's</dd>' : '') +
            '</dl>';

          var liveNote = live ? '<div class="result-banner ok">⏳ ' + t('jobs.live') + '</div>' : '';

          var outHtml;
          if (!outputs || outputs.length === 0) {
            outHtml = '<div class="placeholder">' + t('jobs.noOutput') + '</div>';
          } else {
            outHtml = '<div class="json-block">' + esc(JSON.stringify(outputs, null, 2)) + '</div>';
          }

          var resultHtml = '';
          if (data.result || data.message || data.error) {
            var r = data.result || { message: data.message, error: data.error };
            resultHtml = '<h4 class="section-title">' + t('jobs.result') + '</h4>' +
              '<div class="json-block">' + esc(JSON.stringify(r, null, 2)) + '</div>';
          }

          body.innerHTML = liveNote + meta +
            '<h4 class="section-title">' + t('jobs.output') + '</h4>' + outHtml + resultHtml;

          if (!live) stopAll();
        })
        .catch(function (err) {
          body.innerHTML = '<div class="placeholder">⚠️ ' + esc(err.message) + '</div>';
        });
    }

    load();
    track(setInterval(load, 3000));
  }

  // =============================================
  // QUOTA
  // =============================================
  function renderQuota(root) {
    var uid = effectiveUserId();
    root.innerHTML =
      '<div class="card">' +
        '<div class="toolbar">' +
          '<h3 class="card-title" style="margin:0">📈 ' + t('quota.title') + '</h3>' +
          '<span class="spacer"></span>' +
          '<input id="q-uid" class="field-input" style="max-width:160px" value="' + esc(uid) + '" />' +
          '<button class="btn btn-ghost btn-sm" id="q-refresh">' + t('common.refresh') + '</button>' +
        '</div>' +
        '<div id="q-body"><div class="placeholder"><span class="spinner"></span> ' + t('common.loading') + '</div></div>' +
      '</div>';

    function load() {
      var u = (root.querySelector('#q-uid').value || '').trim() || uid;
      var body = root.querySelector('#q-body');
      API.getQuota(u)
        .then(function (data) {
          var p = data.plan || {};
          var usg = data.usage || {};
          var rem = usg.unlimited ? t('quota.unlimited') : (usg.remainingMinutes + ' ' + t('common.minutes'));
          var lim = usg.unlimited ? t('quota.unlimited') : (usg.limitMinutes + ' ' + t('common.minutes'));
          body.innerHTML =
            '<div class="grid grid-cards">' +
              '<div class="card"><h3 class="card-title">' + t('quota.plan') + '</h3><dl class="kv">' +
                '<dt>' + t('quota.level') + '</dt><dd>' + U().num(p.level) + '</dd>' +
                '<dt>' + t('quota.type') + '</dt><dd>' + esc(data.userType) + '</dd>' +
                '<dt>' + t('quota.subscription') + '</dt><dd>' + esc(p.subscription) + '</dd>' +
                '<dt>' + t('quota.priority') + '</dt><dd>' + U().num(p.priority) + '</dd>' +
                '<dt>' + t('quota.maxTabs') + '</dt><dd>' + U().num(p.maxTabs) + '</dd>' +
                '<dt>' + t('quota.maxSteps') + '</dt><dd>' + U().num(p.maxSteps) + '</dd>' +
                '<dt>' + t('quota.maxSchedules') + '</dt><dd>' + U().num(p.maxSchedules) + '</dd>' +
              '</dl></div>' +
              '<div class="card"><h3 class="card-title">' + t('quota.usage') + '</h3><dl class="kv">' +
                '<dt>' + t('quota.used') + '</dt><dd>' + U().num(usg.usedMinutes) + ' ' + t('common.minutes') + '</dd>' +
                '<dt>' + t('quota.remaining') + '</dt><dd>' + esc(rem) + '</dd>' +
                '<dt>' + t('quota.limit') + '</dt><dd>' + esc(lim) + '</dd>' +
              '</dl></div>' +
            '</div>';
        })
        .catch(function (err) {
          body.innerHTML = '<div class="placeholder">⚠️ ' + esc(err.message) + '</div>';
        });
    }
    root.querySelector('#q-refresh').addEventListener('click', load);
    load();
  }

  // =============================================
  // SCHEDULES
  // =============================================
  function renderSchedules(root) {
    var uid = effectiveUserId();
    root.innerHTML =
      '<div class="card">' +
        '<div class="toolbar">' +
          '<h3 class="card-title" style="margin:0">⏰ ' + t('sched.title') + '</h3>' +
          '<span class="spacer"></span>' +
          '<input id="s-uid" class="field-input" style="max-width:160px" value="' + esc(uid) + '" />' +
          '<button class="btn btn-ghost btn-sm" id="s-refresh">' + t('common.refresh') + '</button>' +
        '</div>' +
        '<div id="s-body"><div class="placeholder"><span class="spinner"></span> ' + t('common.loading') + '</div></div>' +
      '</div>';

    function load() {
      var u = (root.querySelector('#s-uid').value || '').trim() || uid;
      var body = root.querySelector('#s-body');
      API.listSchedules(u)
        .then(function (data) {
          var list = data.schedules || [];
          var head = '<div class="muted" style="margin-bottom:12px">' + t('sched.count') + ': ' +
            U().num(data.count) + ' / ' + U().num(data.limit) + '</div>';
          if (list.length === 0) {
            body.innerHTML = head + '<div class="placeholder">' + t('sched.empty') + '</div>';
            return;
          }
          var rows = list.map(function (s) {
            return '<tr>' +
              '<td>' + esc(s.name) + '</td>' +
              '<td class="mono">' + esc(s.cron) + '</td>' +
              '<td>' + esc(fmtTime(s.nextRun)) + '</td>' +
              '<td>' + esc(s.timezone) + '</td>' +
              '<td><button class="btn btn-ghost btn-sm" data-del="' + esc(s.key) + '">' + t('common.delete') + '</button></td>' +
            '</tr>';
          }).join('');
          body.innerHTML = head +
            '<div class="table-wrap"><table class="data"><thead><tr>' +
            '<th>' + t('sched.name') + '</th><th>' + t('sched.cron') + '</th><th>' + t('sched.next') + '</th>' +
            '<th>' + t('sched.tz') + '</th><th>' + t('sched.actions') + '</th>' +
            '</tr></thead><tbody>' + rows + '</tbody></table></div>';

          body.querySelectorAll('[data-del]').forEach(function (b) {
            b.addEventListener('click', function () {
              if (!confirm(t('sched.confirmDelete'))) return;
              API.deleteSchedule(u, b.getAttribute('data-del'))
                .then(function () { U().toast(t('sched.deleted'), 'success'); load(); })
                .catch(function (err) { U().toast(err.message, 'error'); });
            });
          });
        })
        .catch(function (err) {
          body.innerHTML = '<div class="placeholder">⚠️ ' + esc(err.message) + '</div>';
        });
    }
    root.querySelector('#s-refresh').addEventListener('click', load);
    load();
  }

  // =============================================
  // ADMIN
  // =============================================
  function renderAdmin(root) {
    var token = API.getAdminToken();
    if (!token) { renderAdminLogin(root); return; }
    renderAdminPanel(root);
  }

  function renderAdminLogin(root) {
    root.innerHTML =
      '<div class="card" style="max-width:460px">' +
        '<h3 class="card-title">🛡️ ' + t('admin.title') + '</h3>' +
        '<p class="muted" style="margin-top:0">' + t('admin.hint') + '</p>' +
        '<label class="field"><span class="field-label">' + t('admin.tokenLabel') + '</span>' +
          '<input id="admin-token" type="password" class="field-input" /></label>' +
        '<div id="admin-err"></div>' +
        '<button class="btn btn-primary" id="admin-connect">' + t('admin.connect') + '</button>' +
      '</div>';

    root.querySelector('#admin-connect').addEventListener('click', function () {
      var tk = (root.querySelector('#admin-token').value || '').trim();
      if (!tk) return;
      var errEl = root.querySelector('#admin-err');
      errEl.innerHTML = '';
      API.validateAdminToken(tk)
        .then(function (ok) {
          if (!ok) { errEl.innerHTML = '<div class="result-banner err">' + t('admin.invalidToken') + '</div>'; return; }
          API.setAdminToken(tk);
          renderAdminPanel(root);
        })
        .catch(function () {
          errEl.innerHTML = '<div class="result-banner err">' + t('admin.invalidToken') + '</div>';
        });
    });
  }

  function renderAdminPanel(root) {
    root.innerHTML =
      '<div class="card">' +
        '<div class="toolbar">' +
          '<h3 class="card-title" style="margin:0">🛡️ ' + t('admin.stats') + '</h3>' +
          '<span class="spacer"></span>' +
          '<button class="btn btn-ghost btn-sm" id="admin-refresh">' + t('common.refresh') + '</button>' +
          '<button class="btn btn-ghost btn-sm" id="admin-logout">' + t('admin.disconnect') + '</button>' +
        '</div>' +
        '<div id="admin-body"><div class="placeholder"><span class="spinner"></span> ' + t('common.loading') + '</div></div>' +
      '</div>';

    root.querySelector('#admin-logout').addEventListener('click', function () {
      API.setAdminToken('');
      renderAdminLogin(root);
    });

    function load() {
      var body = root.querySelector('#admin-body');
      API.adminStats()
        .then(function (data) {
          var s = data.stats || data;
          var sys = (s.system) || {};
          var totals = data.totals || data.counters || {};
          // /admin/stats embeds counters at top-level; be defensive.
          var totalJobs = data.totalJobs != null ? data.totalJobs : (data.counters && data.counters.totalJobs);
          var queue = data.queue || data.queueCounts || {};

          body.innerHTML =
            '<div class="grid grid-cards">' +
              '<div class="card"><h3 class="card-title">' + t('admin.stats') + '</h3><dl class="kv">' +
                '<dt>' + t('dash.version') + '</dt><dd>v' + esc(sys.version || data.version) + '</dd>' +
                '<dt>' + t('dash.uptime') + '</dt><dd>' + esc(U().formatUptime(sys.uptime || data.uptime || 0)) + '</dd>' +
                '<dt>Node</dt><dd>' + esc(sys.nodeVersion || '—') + '</dd>' +
                '<dt>Lua</dt><dd>' + esc(sys.luaScripts || '—') + '</dd>' +
              '</dl></div>' +
              '<div class="card"><h3 class="card-title">Queue</h3><dl class="kv">' +
                '<dt>waiting</dt><dd>' + U().num(queue.waiting) + '</dd>' +
                '<dt>active</dt><dd>' + U().num(queue.active) + '</dd>' +
                '<dt>completed</dt><dd>' + U().num(queue.completed) + '</dd>' +
                '<dt>failed</dt><dd>' + U().num(queue.failed) + '</dd>' +
                '<dt>delayed</dt><dd>' + U().num(queue.delayed) + '</dd>' +
              '</dl></div>' +
              '<div class="card"><h3 class="card-title">Raw</h3>' +
                '<div class="json-block" style="max-height:260px">' + esc(JSON.stringify(data, null, 2)) + '</div>' +
              '</div>' +
            '</div>';
        })
        .catch(function (err) {
          if (err.status === 403) { API.setAdminToken(''); renderAdminLogin(root); return; }
          body.innerHTML = '<div class="placeholder">⚠️ ' + esc(err.message) + '</div>';
        });
    }

    root.querySelector('#admin-refresh').addEventListener('click', load);
    load();
  }

  // =============================================
  // Public router entry
  // =============================================
  // ---------------------------------------------
  // Visual node-based Flow editor (step 10, inspired by Automa).
  // The heavy lifting lives in window.FlowEditor (flow-editor.js); this view
  // builds the layout (palette / canvas / inspector) + toolbar and wires the
  // editor's graph<->steps conversion to POST /run.
  // ---------------------------------------------
  function renderEditor(root) {
    var FE = window.FlowEditor;
    if (!FE) {
      root.innerHTML = '<div class="placeholder">⚠️ flow-editor.js not loaded</div>';
      return;
    }

    root.innerHTML =
      '<div class="card">' +
        '<div class="card-head">' +
          '<h2>🧩 ' + t('fe.title') + '</h2>' +
          '<div class="row-actions">' +
            '<button class="btn btn-ghost btn-sm" id="fe-from-run">' + t('fe.fromRun') + '</button>' +
            '<button class="btn btn-ghost btn-sm" id="fe-load">' + t('fe.load') + '</button>' +
            '<button class="btn btn-ghost btn-sm" id="fe-save">' + t('fe.save') + '</button>' +
            '<button class="btn btn-ghost btn-sm" id="fe-clear">' + t('fe.clear') + '</button>' +
            '<button class="btn btn-ghost btn-sm" id="fe-json">' + t('fe.toJson') + '</button>' +
            '<button class="btn btn-primary btn-sm" id="fe-run">▶️ ' + t('fe.run') + '</button>' +
          '</div>' +
        '</div>' +
        '<p class="muted small">' + t('fe.subtitle') + '</p>' +
        '<div class="fe-layout">' +
          '<aside class="fe-palette" id="fe-palette"></aside>' +
          '<div class="fe-canvas" id="fe-canvas">' +
            '<svg class="fe-svg" id="fe-svg"></svg>' +
            '<div class="fe-world" id="fe-world"></div>' +
          '</div>' +
          '<aside class="fe-inspector"><div class="insp-head">' + t('fe.inspector') +
            '</div><div id="fe-inspector"></div></aside>' +
        '</div>' +
        '<div class="muted small fe-hint">' + t('fe.hint') + '</div>' +
        '<div id="fe-result"></div>' +
      '</div>';

    var resultEl = root.querySelector('#fe-result');

    FE.mount({
      canvas: root.querySelector('#fe-canvas'),
      svg: root.querySelector('#fe-svg'),
      world: root.querySelector('#fe-world'),
      palette: root.querySelector('#fe-palette'),
      inspector: root.querySelector('#fe-inspector'),
    });

    root.querySelector('#fe-save').addEventListener('click', function () {
      var ok = FE.saveLocal();
      U().toast(ok ? t('fe.saved') : 'error', ok ? 'ok' : 'error');
    });
    root.querySelector('#fe-load').addEventListener('click', function () {
      FE.loadLocal();
      U().toast(t('fe.loaded'), 'ok');
    });
    root.querySelector('#fe-clear').addEventListener('click', function () {
      FE.reset();
      U().toast(t('fe.cleared'), 'ok');
    });
    root.querySelector('#fe-from-run').addEventListener('click', function () {
      // import the linear builder steps (if the run view was used this session)
      FE.loadSteps(buildPayloadSteps());
      U().toast(t('fe.loaded'), 'ok');
    });
    root.querySelector('#fe-json').addEventListener('click', function () {
      var steps = FE.toSteps();
      resultEl.innerHTML = '<pre class="json-block">' +
        esc(JSON.stringify({ steps: steps }, null, 2)) + '</pre>';
    });

    root.querySelector('#fe-run').addEventListener('click', function () {
      var uid = effectiveUserId();
      if (!uid) { U().toast(t('fe.needUserId'), 'error'); return; }
      var steps = FE.toSteps();
      if (!steps.length) { U().toast(t('fe.noSteps'), 'error'); return; }

      var btn = root.querySelector('#fe-run');
      btn.disabled = true;
      var label = btn.textContent;
      btn.textContent = t('fe.running');
      resultEl.innerHTML = '';

      API.runFlow({ userId: uid, steps: steps, headless: true })
        .then(function (data) {
          resultEl.innerHTML =
            '<div class="result-banner ok">✅ ' + t('fe.queued') +
            ' <code>' + esc(data.jobId) + '</code> ' +
            '<button class="btn btn-ghost btn-sm" id="fe-goto-job" data-job="' +
            esc(data.jobId) + '">' + t('run.viewJob') + '</button> ' +
            '<span class="muted small">(' + steps.length + ' ' + t('fe.steps') + ')</span></div>';
          var g = resultEl.querySelector('#fe-goto-job');
          if (g) g.addEventListener('click', function () {
            location.hash = '#/jobs?job=' + encodeURIComponent(data.jobId) +
              '&user=' + encodeURIComponent(uid);
          });
        })
        .catch(function (err) {
          resultEl.innerHTML = '<div class="result-banner err">❌ ' +
            esc(err && err.message ? err.message : String(err)) + '</div>';
        })
        .then(function () { btn.disabled = false; btn.textContent = label; });
    });
  }

  function render(route, root) {
    switch (route) {
      case 'run': return renderRun(root);
      case 'editor': return renderEditor(root);
      case 'jobs': return renderJobs(root);
      case 'live':
        if (window.LiveView && typeof window.LiveView.render === 'function') {
          return window.LiveView.render(root);
        }
        root.innerHTML = '<div class="placeholder">🚧 ' + t('common.comingSoon') + '</div>';
        return;
      case 'quota': return renderQuota(root);
      case 'schedules': return renderSchedules(root);
      case 'admin': return renderAdmin(root);
      default:
        root.innerHTML = '<div class="placeholder">🚧 ' + t('common.comingSoon') + '</div>';
    }
  }

  window.Views = { render: render, stopAll: stopAll };
})();
