// Live sync with the Home HQ server on the Mac mini.
// - Loads the saved household state before the app starts (falls back to the built-in demo data
//   when there is no server, e.g. a static deploy).
// - Pushes changes made on this screen (only the collections that changed).
// - Applies changes made elsewhere (admin on a phone, the agent over iMessage, Plex, weather).
(function () {
  'use strict';
  var D = window.DATA;
  var CLIENT = Math.random().toString(36).slice(2, 10);
  var KEYS = ['people', 'family', 'routines', 'chores', 'stars', 'week', 'stores', 'catOrder', 'groceries', 'catalog',
    'usuals', 'rooms', 'devices', 'climate', 'media', 'cameras', 'scenes', 'weather', 'photos', 'agents', 'events', 'settings',
    'commute', 'bart', 'music', 'notes', 'games', 'display'];
  var LIVE = ['bart', 'music', 'commute', 'weather', 'climate', 'media'];
  // Keys this screen saves back. The phone app (signed in) also saves photo favourites.
  var OPEN = ['display', 'notes', 'games', 'chores', 'stars', 'week', 'groceries', 'events', 'devices', 'climate'].concat(window.HQ_EXTRA_PUSH || []);
  var snap = {}, rev = 0, online = false, pending = null, pushTimer = null, sceneHint = null;

  var HQ = window.HQ = { client: CLIENT, online: function () { return online; } };

  function rid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  D._gid = function () { return rid('g'); };
  D._eid = function () { return rid('e'); };

  function revive(k, v) {
    if (k === 'events' && Array.isArray(v)) {
      v.forEach(function (e) { e.start = new Date(e.start); e.end = new Date(e.end); });
    }
    return v;
  }
  function apply(patch) {
    Object.keys(patch).forEach(function (k) {
      if (KEYS.indexOf(k) < 0) return;
      D[k] = revive(k, patch[k]);
      snap[k] = JSON.stringify(D[k]);
    });
    if (patch.people) D.ALL = D.people.map(function (p) { return p.id; });
    if (patch.settings) applySettings();
  }
  function applySettings() {
    var S = D.settings || {};
    if (S.title) document.title = S.title;
    var hidden = S.hiddenViews || [];
    Array.prototype.forEach.call(document.querySelectorAll('.rail-item'), function (b) {
      b.style.display = hidden.indexOf(b.dataset.go) > -1 ? 'none' : '';
    });
  }

  function load() {
    return fetch('/api/state', { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      apply(j.state); rev = j.rev; online = true;
    }).catch(function () {
      online = false;
      KEYS.forEach(function (k) { if (D[k] !== undefined) snap[k] = JSON.stringify(D[k]); });
    });
  }

  // ------------------------------------------------------------ outgoing
  function diff() {
    var out = null;
    OPEN.forEach(function (k) {
      if (D[k] === undefined) return;
      var s = JSON.stringify(D[k]);
      if (s !== snap[k]) { out = out || {}; out[k] = D[k]; snap[k] = s; }
    });
    return out;
  }
  function schedulePush() {
    if (!online) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, 250);
  }
  function push() {
    var p = diff();
    if (!p) return;
    var body = { patch: p, client: CLIENT };
    if (sceneHint) { body.scene = sceneHint; sceneHint = null; }
    fetch('/api/state', { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-HQ': '1' }, body: JSON.stringify(body) })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { rev = Math.max(rev, j.rev); })
      .catch(function () {
        // Put the keys back as "dirty" so the next change (or reconnect) retries them.
        Object.keys(p).forEach(function (k) { snap[k] = ''; });
        if (window.App) App.toast('Couldn’t save to the Mac mini · will retry', { tone: 'error', icon: 'bolt', ms: 3000 });
      });
  }
  HQ.scene = function (id) { sceneHint = id; };
  // Re-read everything (the phone app calls this when it comes back to the foreground)
  HQ.refresh = function () { return load().then(refreshUI); };

  // ------------------------------------------------------------ incoming
  var rerenderTimer = null;
  function busy() {
    var a = document.activeElement;
    return (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) || document.querySelector('#sheetLayer.is-open');
  }
  function refreshUI() {
    clearTimeout(rerenderTimer);
    if (!window.App || !App.current) return;
    App.emit('data');
    if (busy()) { rerenderTimer = setTimeout(refreshUI, 2000); return; }
    App.rerender();
  }
  function connect() {
    if (!online || !window.EventSource) return;
    var es = new EventSource('/api/events');
    es.onmessage = function (m) {
      var msg; try { msg = JSON.parse(m.data); } catch (e) { return; }
      if (msg.type === 'hello' && msg.rev > rev) {
        load().then(refreshUI);
      } else if (msg.type === 'patch') {
        rev = Math.max(rev, msg.rev);
        if (msg.client === CLIENT) return;
        apply(msg.patch);
        // Live feeds (BART, Spotify, weather) only repaint the views that show them.
        var keys = Object.keys(msg.patch);
        if (keys.every(function (k) { return LIVE.indexOf(k) > -1; })) { if (window.App && App.current) App.emit('live', keys); return; }
        refreshUI();
      } else if (msg.type === 'announce' && window.App) {
        if (App.mode !== 'day') App.setMode('day');
        App.toast(App.esc(msg.text), { icon: msg.icon || 'bell', ms: 12000 });
      }
    };
    es.onerror = function () { /* EventSource reconnects on its own; hello re-syncs */ };
  }

  // Called by App.start once the views exist.
  HQ.attach = function () {
    App.on('data', schedulePush);
    applySettings();
    connect();
    setInterval(schedulePush, 60000); // retry anything that failed to save
  };
  window.HQ_READY = load();
})();
