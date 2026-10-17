// Home controls: scenes, lights, shades, locks, garage and climate. Same devices as the frame's
// Home tab; changes run the matching Apple Home shortcut on the Mac mini.
(function () {
  'use strict';
  var D = window.DATA;
  function devs() { return D.devices || []; }
  function dev(id) { return devs().filter(function (d) { return d.id === id; })[0]; }
  function state(d) {
    if (d.type === 'light') return d.on ? (d.level || 100) + '%' : 'Off';
    if (d.type === 'blind') return d.pos === 0 ? 'Closed' : d.pos === 100 ? 'Open' : d.pos + '% open';
    if (d.type === 'lock') return d.locked ? 'Locked' : 'Unlocked';
    if (d.type === 'garage') return d.state === 'open' ? 'Open' : 'Closed';
    return d.on ? 'On' : 'Off';
  }
  function isOn(d) { return d.type === 'light' ? d.on : d.type === 'blind' ? d.pos > 0 : d.type === 'lock' ? !d.locked : d.type === 'garage' ? d.state === 'open' : !!d.on; }
  var ICON = { light: 'bulb', blind: 'blinds', lock: 'lock', garage: 'garage' };
  function tile(d) {
    var tint = (d.source === 'govee' || d.source === 'elgato') && d.on ? (d.color || (d.kelvin ? kHex(d.kelvin) : '')) : '';
    return '<button class="dv dv--' + d.type + (isOn(d) ? ' is-on' : '') + (d.online === false ? ' is-off' : '') + '" data-dev="' + App.esc(d.id) + '"' + (tint ? ' style="--tint:' + tint + '"' : '') + '>' + App.icon(d.type === 'lock' && !d.locked ? 'unlock' : ICON[d.type] || 'bolt', 22) +
      '<b>' + App.esc(d.name) + '</b><small>' + state(d) + '</small></button>';
  }
  function set(id, patch) {
    var d = dev(id); if (!d) return;
    Object.assign(d, patch); App.save(); App.rerender();
  }
  function scene(id) {
    var s = (D.scenes || []).filter(function (x) { return x.id === id; })[0]; if (!s) return;
    Object.keys(s.set || {}).forEach(function (k) { var d = dev(k), v = s.set[k]; if (!d) return; if (d.type === 'blind') d.pos = v; else if (v === 0) d.on = false; else { d.on = true; d.level = v; } });
    if (id === 'away' || id === 'night') devs().forEach(function (d) { if (d.type === 'lock') d.locked = true; });
    if (window.HQ && HQ.scene) HQ.scene(id);
    App.save(); App.rerender();
    App.toast(App.esc(s.name) + ' scene on', { icon: s.icon || 'bolt', ms: 1800 });
  }
  // Govee lights: brightness, colours, whites and Govee scenes
  var SW = ['#FF3B1F', '#FF7A1A', '#FFB020', '#FFE14D', '#5FD068', '#2EC4B6', '#3A86FF', '#7B4DFF', '#D94DFF', '#FF5FA2'];
  var WH = [[2200, 'Candle'], [2700, 'Warm'], [4000, 'Neutral'], [5500, 'Day'], [6500, 'Cool']];
  function kHex(k) { return k <= 2900 ? '#FFC27A' : k <= 3600 ? '#FFD9A8' : k <= 4600 ? '#FFEBD2' : k <= 5600 ? '#FFF5EA' : '#F2F4FF'; }
  function goveeSheet(d) {
    var g = d.gv || d.caps || {}, kel = g.kelvin, isGv = d.source === 'govee';
    App.sheet('<div class="sh-pad"><h2 class="sh-h">' + App.esc(d.name) + '</h2><p class="sh-p" data-v>' + state(d) + (d.online === false ? ' · offline' : '') + '</p>' +
      '<div class="lt-row"><button class="btn' + (d.on ? '' : ' btn--solid') + '" data-pw>' + (d.on ? 'Off' : 'On') + '</button><input class="big-range" type="range" min="1" max="100" value="' + (d.level || 100) + '" aria-label="Brightness"></div>' +
      (g.color ? '<div class="sec-l">Colour</div><div class="sw">' + SW.map(function (c) { return '<button data-c="' + c + '" class="' + (d.color === c ? 'is-on' : '') + '" style="background:' + c + '"></button>'; }).join('') +
        '<label class="sw-any"><input type="color" value="' + (d.color || '#FFB020') + '"></label></div>' : '') +
      (kel ? '<div class="sec-l">Warm ↔ cool <b class="ct-kv" data-kv>' + (d.kelvin && !d.color ? d.kelvin + 'K' : '') + '</b></div>' +
        '<input class="ct-range" type="range" min="' + kel[0] + '" max="' + kel[1] + '" step="50" value="' + (d.kelvin || Math.round((kel[0] + kel[1]) / 2 / 50) * 50) + '" data-ct aria-label="Colour temperature, warm to cool">' : '') +
      (kel ? '<div class="chips">' + WH.filter(function (w) { return w[0] >= kel[0] - 300 && w[0] <= kel[1] + 300; }).map(function (w) { var k = Math.max(kel[0], Math.min(kel[1], w[0])); return '<button class="chip' + (d.kelvin === k && !d.color ? ' is-on' : '') + '" data-k="' + k + '"><i class="wh" style="background:' + kHex(k) + '"></i>' + w[1] + '</button>'; }).join('') + '</div>' : '') +
      (isGv ? '<div class="sec-l">Govee scenes</div><div class="chips sc-list"><span class="muted">Loading…</span></div>' : '') + '</div>', {
      tall: true,
      onMount: function (s, close) {
        function apply(patch) { set(d.id, patch); var v = s.querySelector('[data-v]'); if (v) v.textContent = state(d); }
        function mark(t) { App.$$('[data-c],[data-k]', s).forEach(function (b) { b.classList.toggle('is-on', b === t); }); }
        s.addEventListener('click', function (e) {
          var t;
          if (e.target.closest('[data-pw]')) { apply({ on: !d.on, level: d.level || 100 }); close(); return; }
          if ((t = e.target.closest('[data-c]'))) { apply({ on: true, color: t.dataset.c, kelvin: null }); mark(t); return; }
          if ((t = e.target.closest('[data-k]'))) { apply({ on: true, kelvin: +t.dataset.k, color: null }); mark(t); var c2 = s.querySelector('[data-ct]'); if (c2) { c2.value = t.dataset.k; s.querySelector('[data-kv]').textContent = t.dataset.k + 'K'; } return; }
          if ((t = e.target.closest('[data-scene-n]'))) {
            App.$$('[data-scene-n]', s).forEach(function (b) { b.classList.toggle('is-on', b === t); });
            App.post('/api/home/govee/scene', { id: d.id, name: t.dataset.sceneN }).then(function () { App.toast(App.esc(t.dataset.sceneN), { icon: 'bulb', ms: 1600 }); })
              .catch(function (er) { App.toast(App.esc(er.message), { tone: 'error', icon: 'bulb' }); });
          }
        });
        s.querySelector('.big-range').addEventListener('change', function (e) { apply({ on: true, level: +e.target.value }); });
        var ct = s.querySelector('[data-ct]');
        if (ct) {
          ct.addEventListener('input', function () { s.querySelector('[data-kv]').textContent = ct.value + 'K'; });
          ct.addEventListener('change', function () { apply({ on: true, kelvin: +ct.value, color: null }); App.$$('[data-c],[data-k]', s).forEach(function (b) { b.classList.toggle('is-on', +b.dataset.k === +ct.value); }); });
        }
        var pick = s.querySelector('.sw-any input'); if (pick) pick.addEventListener('change', function (e) { apply({ on: true, color: e.target.value.toUpperCase(), kelvin: null }); mark(null); });
        if (isGv) App.get('/api/home/govee/scenes?id=' + encodeURIComponent(d.id)).then(function (list) {
          var box = s.querySelector('.sc-list'); if (!box) return;
          box.innerHTML = list.length ? list.slice(0, 80).map(function (o) { return '<button class="chip" data-scene-n="' + App.esc(o.name) + '">' + App.esc(o.name) + '</button>'; }).join('') : '<span class="muted">No scenes for this light.</span>';
        }).catch(function () { var box = s.querySelector('.sc-list'); if (box) box.innerHTML = '<span class="muted">Scenes aren’t available right now.</span>'; });
      },
      onClose: function () { App.rerender(); }
    });
  }
  // Cameras: a still on each tile (refreshed when the screen opens), live video in a sheet
  function camsHTML() {
    var C = (D.cameras || []).filter(function (c) { return c.live; });
    if (!C.length) return '';
    return '<div class="sec-l">Cameras</div><div class="cams-p">' + C.map(function (c) {
      return '<button class="cam-p" data-camp="' + App.esc(c.id) + '"><img src="/api/home/camera/' + encodeURIComponent(c.id) + '/snapshot.jpg?t=' + Date.now() + '" alt=""><span><i></i>' + App.esc(c.name) + '</span></button>';
    }).join('') + '</div>';
  }
  function camSheet(id) {
    var c = (D.cameras || []).filter(function (x) { return x.id === id; })[0]; if (!c) return;
    App.sheet('<div class="sh-pad"><h2 class="sh-h">' + App.esc(c.name) + '</h2><p class="sh-p" data-cs>Connecting…</p>' +
      '<div class="cam-live-p"><img class="cam-still-p" src="/api/home/camera/' + encodeURIComponent(c.id) + '/snapshot.jpg?t=' + Date.now() + '" alt="">' +
      '<img class="cam-live-img" src="/api/home/camera/' + encodeURIComponent(c.id) + '/live?t=' + Date.now() + '" alt=""></div></div>', {
      tall: true,
      onMount: function (s) {
        var v = s.querySelector('.cam-live-img');
        v.addEventListener('load', function () { s.querySelector('[data-cs]').textContent = '● Live'; });
        v.addEventListener('error', function () { s.querySelector('[data-cs]').textContent = 'Live video unavailable · showing a snapshot'; v.style.display = 'none'; });
      },
      onClose: function () { var v = document.querySelector('.cam-live-img'); if (v) { v.src = ''; v.removeAttribute('src'); } }
    });
  }
  function open(d) {
    if (d.source === 'govee' || d.source === 'elgato') return goveeSheet(d);
    if (d.type === 'light' || d.type === 'blind') {
      var v = d.type === 'light' ? (d.on ? d.level || 100 : 0) : d.pos;
      App.sheet('<div class="sh-pad"><h2 class="sh-h">' + App.esc(d.name) + '</h2><p class="sh-p" data-v>' + state(d) + '</p>' +
        '<input class="big-range" type="range" min="0" max="100" step="5" value="' + v + '" aria-label="Level">' +
        '<div class="sh-actions"><button class="btn" data-off>' + (d.type === 'light' ? 'Turn off' : 'Close') + '</button><button class="btn btn--solid" data-full>' + (d.type === 'light' ? 'Full' : 'Open') + '</button></div></div>', {
        onMount: function (s, close) {
          var r = s.querySelector('input');
          function apply(x) { if (d.type === 'light') set(d.id, x ? { on: true, level: x } : { on: false }); else set(d.id, { pos: x }); s.querySelector('[data-v]').textContent = state(d); }
          r.addEventListener('change', function () { apply(+r.value); });
          r.addEventListener('input', function () { s.querySelector('[data-v]').textContent = d.type === 'light' ? (+r.value ? r.value + '%' : 'Off') : r.value + '%'; });
          s.querySelector('[data-off]').onclick = function () { apply(0); close(); };
          s.querySelector('[data-full]').onclick = function () { apply(100); close(); };
        }
      });
      return;
    }
    if (d.type === 'lock') {
      if (d.locked) return App.confirm('Unlock ' + App.esc(d.name) + '?', 'Anyone at the door can come in.', 'Unlock', function () { set(d.id, { locked: false }); });
      return set(d.id, { locked: true });
    }
    if (d.type === 'garage') return App.confirm((d.state === 'open' ? 'Close ' : 'Open ') + App.esc(d.name) + '?', '', d.state === 'open' ? 'Close' : 'Open', function () { set(d.id, { state: d.state === 'open' ? 'closed' : 'open' }); });
    set(d.id, { on: !d.on });
  }
  function climate() {
    var C = D.climate || {};
    if (!C.enabled) return '';
    var unit = D.settings && D.settings.units === 'celsius' ? '°' : '°';
    return '<div class="card cl"><div class="card-h">' + App.icon('thermo', 18) + '<span>Climate</span><small>Inside ' + (C.current != null ? C.current + unit : '–') + '</small></div>' +
      '<div class="cl-row"><button data-cl="-1" aria-label="Cooler">' + App.icon('minus', 22) + '</button><b>' + C.set + unit + '</b><button data-cl="1" aria-label="Warmer">' + App.icon('plus', 22) + '</button></div>' +
      '<div class="seg seg--full">' + ['off', 'heat', 'cool', 'auto'].map(function (m) { return '<button data-clm="' + m + '" class="' + (C.mode === m ? 'is-on' : '') + '">' + m.charAt(0).toUpperCase() + m.slice(1) + '</button>'; }).join('') + '</div></div>';
  }

  function tvEntry() {
    var T = D.tv || {}; if (!T.paired) return '';
    var P = T.playing || {};
    var sub = !T.connected ? 'Not connected' : T.power === 'off' ? 'Asleep' : P.title ? P.title : T.app ? T.app.name : 'On';
    return '<div class="group menu"><button class="menu-i" data-go="tv"><span class="menu-ico" style="background:#2A2621">' + App.icon('tv', 20) + '</span><span><b>' + App.esc(T.name || 'Apple TV') + '</b><small>' + App.esc(sub) + '</small></span>' + App.icon('right', 18) + '</button></div>';
  }
  App.screen('home', {
    tab: 'more',
    render: function (el) {
      var rooms = (D.rooms || []).slice(), list = devs(), sc = D.scenes || [];
      var on = list.filter(function (d) { return d.type === 'light' && d.on; }).length;
      var body = '';
      if (!list.length && !sc.length && !(D.climate && D.climate.enabled) && !(D.tv && D.tv.paired)) {
        body = '<div class="empty">' + App.icon('bulb', 30) + '<b>Nothing set up yet</b><span>Add your Govee key, pair the Apple TV, or link Apple Home lights in Admin → Lights &amp; Home. They show up here and on the frame.</span></div>';
      } else {
        body = tvEntry() + (sc.length ? '<div class="sec-l">Scenes</div><div class="scenes">' + sc.map(function (s) { return '<button data-scene="' + App.esc(s.id) + '">' + App.icon(s.icon || 'bolt', 20) + '<span>' + App.esc(s.name) + '</span></button>'; }).join('') + '</div>' : '') +
          climate() + camsHTML() +
          rooms.concat(list.some(function (d) { return !rooms.some(function (r) { return r.id === d.room; }); }) ? [{ id: '__other', name: 'Other' }] : []).map(function (r) {
            var ds = list.filter(function (d) { return r.id === '__other' ? !rooms.some(function (x) { return x.id === d.room; }) : d.room === r.id; });
            return '<div class="sec-l">' + App.esc(r.name) + '</div>' + (ds.length ? '<div class="dvs">' + ds.map(tile).join('') + '</div>' : '<p class="dvs-empty">No devices yet</p>');
          }).join('') +
          (on ? '<button class="btn btn--wide" data-alloff>' + App.icon('bulb', 18) + 'Turn off all lights</button>' : '');
      }
      el.innerHTML = '<button class="back" data-go="more">' + App.icon('left', 20) + 'More</button>' +
        App.head('Home', list.length ? (on ? on + (on === 1 ? ' light on' : ' lights on') : 'All lights off') : '') + body;
      if (!el.dataset.wired) {
        el.dataset.wired = '1';
        el.addEventListener('click', function (e) {
          var t;
          if ((t = e.target.closest('[data-go]'))) return App.go(t.dataset.go);
          if ((t = e.target.closest('[data-camp]'))) return camSheet(t.dataset.camp);
          if ((t = e.target.closest('[data-scene]'))) return scene(t.dataset.scene);
          if ((t = e.target.closest('[data-dev]'))) { var d = dev(t.dataset.dev); if (d) open(d); return; }
          if (e.target.closest('[data-alloff]')) { devs().forEach(function (d) { if (d.type === 'light') d.on = false; }); App.save(); App.rerender(); return App.toast('All lights off', { icon: 'bulb' }); }
          if ((t = e.target.closest('[data-cl]'))) { var C = D.climate; C.set = Math.round((C.set + +t.dataset.cl) * 2) / 2; App.save(); return App.rerender(); }
          if ((t = e.target.closest('[data-clm]'))) { D.climate.mode = t.dataset.clm; App.save(); return App.rerender(); }
        });
      }
    }
  });
})();
