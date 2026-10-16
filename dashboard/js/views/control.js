// Home control: status summary, scenes, rooms of tiles, climate, cameras, media.
(function () {
  'use strict';
  var D = window.DATA;
  var V = { el: null, pending: {}, scene: null, camTimer: null, camAge: 4 };

  function dev(id) { return D.devices.filter(function (d) { return d.id === id; })[0]; }
  var NO_GARAGE = { id: 'none', type: 'garage', name: 'Garage', state: 'closed' };
  function garageDev() { return D.devices.filter(function (d) { return d.type === 'garage'; })[0] || NO_GARAGE; }

  // Optimistic device update: flip immediately, confirm (or revert) shortly after.
  App.setDevice = function (id, patch, opts) {
    var d = dev(id), before = {};
    Object.keys(patch).forEach(function (k) { before[k] = d[k]; d[k] = patch[k]; });
    V.pending[id] = true;
    changed([id]);
    setTimeout(function () {
      delete V.pending[id];
      if (d.flaky && !(opts && opts.silent)) {
        Object.keys(before).forEach(function (k) { d[k] = before[k]; });
        App.toast('Couldn’t reach <b>' + d.name + '</b> · it may be offline', { tone: 'error', icon: 'bolt' });
        changed([id]);
      } else paintTile(id);
    }, d.flaky ? 2600 : 600);
  };

  // ------------------------------------------------------------ colour helpers (Govee lights)
  function rgba(hex, a) { var n = parseInt(String(hex).slice(1), 16); return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')'; }
  // Rough colour of white light at a colour temperature, for the tile tint
  function kelvinHex(k) { return k <= 2900 ? '#FFC27A' : k <= 3600 ? '#FFD9A8' : k <= 4600 ? '#FFEBD2' : k <= 5600 ? '#FFF5EA' : '#F2F4FF'; }
  var SWATCHES = [['#FF3B1F', 'Red'], ['#FF7A1A', 'Orange'], ['#FFB020', 'Amber'], ['#FFE14D', 'Yellow'], ['#5FD068', 'Green'], ['#2EC4B6', 'Teal'],
    ['#3A86FF', 'Blue'], ['#7B4DFF', 'Purple'], ['#D94DFF', 'Magenta'], ['#FF5FA2', 'Pink']];
  var WHITES = [[2200, 'Candle'], [2700, 'Warm'], [4000, 'Neutral'], [5500, 'Daylight'], [6500, 'Cool']];
  function post(url, body) {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-HQ': '1' }, body: JSON.stringify(body || {}) })
      .then(function (r) { return r.text().then(function (t) { var j = {}; try { j = JSON.parse(t); } catch (e) {} if (!r.ok) throw new Error(j.error || 'Couldn’t reach the Mac mini'); return j; }); });
  }
  App.lightSheet = function (id) {
    var d = dev(id); if (!d) return;
    var g = d.gv || {}, kel = g.kelvin;
    App.sheet('<div class="sheet-pad ls"><div class="label">' + App.esc(d.name) + '</div><h2 class="serif sheet-h" data-ls-state>' + (d.on ? (d.level || 100) + '%' : 'Off') + '</h2>' +
      '<div class="ls-row"><button class="btn' + (d.on ? '' : ' btn--solid') + '" data-ls-power>' + App.icon('bulb', 22) + (d.on ? 'Turn off' : 'Turn on') + '</button>' +
      '<input class="ls-range" type="range" min="1" max="100" value="' + (d.level || 100) + '" data-ls-level aria-label="Brightness"></div>' +
      (g.color ? '<div class="label">Colour</div><div class="ls-sw">' + SWATCHES.map(function (c) { return '<button data-ls-color="' + c[0] + '" class="' + (d.color === c[0] ? 'is-on' : '') + '" style="background:' + c[0] + '" aria-label="' + c[1] + '"></button>'; }).join('') +
        '<label class="ls-custom" aria-label="Pick any colour" style="background:conic-gradient(red,yellow,lime,cyan,blue,magenta,red)"><input type="color" value="' + (d.color || '#FFB020') + '" data-ls-pick></label></div>' : '') +
      (kel ? '<div class="label">Whites</div><div class="ls-wh">' + WHITES.filter(function (w) { return w[0] >= kel[0] - 300 && w[0] <= kel[1] + 300; }).map(function (w) {
        var k = Math.max(kel[0], Math.min(kel[1], w[0]));
        return '<button data-ls-k="' + k + '" class="' + (d.kelvin === k && !d.color ? 'is-on' : '') + '"><i style="background:' + kelvinHex(k) + '"></i>' + w[1] + '</button>'; }).join('') + '</div>' : '') +
      '<div class="label">Govee scenes</div><div class="ls-scenes"><span class="ls-note">Loading scenes…</span></div></div>', {
      cls: 'sheet--wide',
      onMount: function (s, close) {
        function set(patch) { App.setDevice(d.id, patch); s.querySelector('[data-ls-state]').textContent = d.on ? (d.level || 100) + '%' : 'Off'; }
        s.addEventListener('click', function (e) {
          var t;
          if (e.target.closest('[data-ls-power]')) { set({ on: !d.on, level: d.level || 100 }); close(); return; }
          if ((t = e.target.closest('[data-ls-color]'))) { set({ on: true, color: t.dataset.lsColor, kelvin: null }); App.$$('[data-ls-color],[data-ls-k]', s).forEach(function (b) { b.classList.toggle('is-on', b === t); }); return; }
          if ((t = e.target.closest('[data-ls-k]'))) { set({ on: true, kelvin: +t.dataset.lsK, color: null }); App.$$('[data-ls-color],[data-ls-k]', s).forEach(function (b) { b.classList.toggle('is-on', b === t); }); return; }
          if ((t = e.target.closest('[data-ls-scene]'))) {
            App.$$('[data-ls-scene]', s).forEach(function (b) { b.classList.toggle('is-on', b === t); });
            post('/api/home/govee/scene', { id: d.id, name: t.dataset.lsScene }).then(function () { App.toast('<b>' + App.esc(t.dataset.lsScene) + '</b> on ' + App.esc(d.name), { icon: 'bulb', ms: 2200 }); })
              .catch(function (er) { App.toast(App.esc(er.message), { tone: 'error', icon: 'bulb' }); });
          }
        });
        s.querySelector('[data-ls-level]').addEventListener('change', function (e) { set({ on: true, level: +e.target.value }); });
        var pick = s.querySelector('[data-ls-pick]');
        if (pick) pick.addEventListener('change', function (e) { set({ on: true, color: e.target.value.toUpperCase(), kelvin: null }); });
        fetch('/api/home/govee/scenes?id=' + encodeURIComponent(d.id), { cache: 'no-store' }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error); return j; }); })
          .then(function (list) {
            var box = s.querySelector('.ls-scenes'); if (!box) return;
            box.innerHTML = list.length ? list.slice(0, 60).map(function (o) { return '<button class="chip" data-ls-scene="' + App.esc(o.name) + '">' + App.esc(o.name) + '</button>'; }).join('') : '<span class="ls-note">This light has no Govee scenes.</span>';
          }).catch(function () { var box = s.querySelector('.ls-scenes'); if (box) box.innerHTML = '<span class="ls-note">Scenes aren’t available right now.</span>'; });
      }
    });
  };

  // ------------------------------------------------------------ Apple TV
  function tvCard() {
    var T = D.tv || {};
    if (!T.paired) return '';
    var P = T.playing || {}, asleep = T.power === 'off';
    var line = !T.connected ? 'Not connected' : asleep ? 'Asleep' : P.title ? App.esc(P.title) + (P.artist ? ' · ' + App.esc(P.artist) : '') : T.app ? App.esc(T.app.name) : 'Home screen';
    return '<div class="tv-h"><span class="label">' + App.icon('tv', 16) + ' ' + App.esc(T.name || 'Apple TV') + '</span>' +
      '<button class="tv-pw' + (asleep ? '' : ' is-on') + '" data-tv-power aria-label="Power">' + App.icon('power', 20) + '</button></div>' +
      '<div class="tv-now">' + line + '</div>' +
      '<div class="tv-pad"><button data-tv="up" class="tv-u" aria-label="Up">' + App.icon('up', 26) + '</button><button data-tv="left" class="tv-l" aria-label="Left">' + App.icon('left', 26) + '</button>' +
      '<button data-tv="select" class="tv-ok" aria-label="Select">OK</button><button data-tv="right" class="tv-r" aria-label="Right">' + App.icon('right', 26) + '</button><button data-tv="down" class="tv-d" aria-label="Down">' + App.icon('down', 26) + '</button></div>' +
      '<div class="tv-row"><button data-tv="menu">Back</button><button data-tv="home" aria-label="TV home">' + App.icon('home', 20) + '</button>' +
      '<button data-tv="play_pause" aria-label="Play or pause">' + App.icon(P.playing ? 'pause' : 'play', 20) + '</button>' +
      '<button data-tv="volume_down" aria-label="Volume down">' + App.icon('minus', 20) + '</button><button data-tv="volume_up" aria-label="Volume up">' + App.icon('plus', 20) + '</button>' +
      '<button data-tv-apps aria-label="Apps">Apps</button></div>';
  }
  App.tvKey = function (name, extra) {
    if (navigator.vibrate) navigator.vibrate(8);
    return post('/api/home/tv/key', Object.assign({ name: name }, extra || {})).catch(function (e) { App.toast(App.esc(e.message), { tone: 'error', icon: 'film', ms: 2500 }); });
  };
  App.tvApps = function () {
    App.sheet('<div class="sheet-pad"><div class="label">Apple TV</div><h2 class="serif sheet-h">Open an app</h2><div class="tv-apps"><span class="ls-note">Loading apps…</span></div></div>', {
      cls: 'sheet--wide',
      onMount: function (s, close) {
        fetch('/api/home/tv/apps', { cache: 'no-store' }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error); return j; }); }).then(function (list) {
          s.querySelector('.tv-apps').innerHTML = list.map(function (a) { return '<button class="chip" data-app="' + App.esc(a.id) + '">' + App.esc(a.name) + '</button>'; }).join('');
        }).catch(function (e) { s.querySelector('.tv-apps').innerHTML = '<span class="ls-note">' + App.esc(e.message) + '</span>'; });
        s.addEventListener('click', function (e) {
          var b = e.target.closest('[data-app]'); if (!b) return;
          close(); App.toast('Opening <b>' + App.esc(b.textContent) + '</b>', { icon: 'film', ms: 2000 });
          post('/api/home/tv/launch', { id: b.dataset.app }).catch(function (er) { App.toast(App.esc(er.message), { tone: 'error', icon: 'film' }); });
        });
      }
    });
  };

  // ------------------------------------------------------------ tiles
  function tile(d) {
    var pend = V.pending[d.id] ? '<i class="pend"></i>' : '';
    if (d.type === 'light') {
      var gv = d.source === 'govee', tint = gv && d.on && d.color ? 'background:' + rgba(d.color, .5) : gv && d.on && d.kelvin ? 'background:' + rgba(kelvinHex(d.kelvin), .6) : '';
      return '<div class="tile tile--light' + (d.on ? ' is-on' : '') + (d.online === false ? ' is-offline' : '') + '" data-dev="' + d.id + '" style="--lvl:' + (d.on ? d.level : 0) + '%">' +
        '<span class="tile-fill"' + (tint ? ' style="' + tint + '"' : '') + '></span>' + pend +
        (gv ? '<button class="tile-more" data-lightsheet="' + d.id + '" aria-label="Colour and scenes"><i style="background:' + (d.color || (d.kelvin ? kelvinHex(d.kelvin) : '#F3C77A')) + '"></i></button>' : '') +
        '<span class="tile-icon">' + App.icon('bulb', 28) + '</span>' +
        '<span class="tile-name">' + d.name + '</span>' +
        '<span class="tile-state num">' + (d.on ? d.level + '%' : 'Off') + '</span></div>';
    }
    if (d.type === 'blind') {
      return '<div class="tile tile--blind' + (d.pos > 0 ? ' is-on' : '') + '" data-dev="' + d.id + '" style="--lvl:' + d.pos + '%">' +
        '<span class="tile-fill"></span>' + pend +
        '<span class="tile-icon">' + App.icon('blinds', 28) + '</span>' +
        '<span class="tile-name">' + d.name + '</span>' +
        '<span class="tile-state num">' + (d.pos === 0 ? 'Closed' : d.pos === 100 ? 'Open' : d.pos + '% open') + '</span></div>';
    }
    if (d.type === 'lock') {
      return '<div class="tile tile--lock' + (d.locked ? '' : ' is-warn') + '" data-dev="' + d.id + '">' + pend +
        '<span class="tile-icon">' + App.icon(d.locked ? 'lock' : 'unlock', 28) + '</span>' +
        '<span class="tile-name">' + d.name + '</span>' +
        '<span class="tile-state">' + (d.locked ? 'Locked<small>Hold to unlock</small>' : 'Unlocked<small>Tap to lock</small>') + '</span>' +
        '<svg class="hold-ring" viewBox="0 0 40 40"><circle cx="20" cy="20" r="17"/></svg></div>';
    }
    if (d.type === 'garage') {
      var label = { closed: 'Closed', open: 'Open', opening: 'Opening…', closing: 'Closing…' }[d.state];
      return '<div class="tile tile--garage' + (d.state !== 'closed' ? ' is-warn' : '') + (/ing$/.test(d.state) ? ' is-moving' : '') + '" data-dev="' + d.id + '">' + pend +
        '<span class="tile-icon">' + App.icon('garage', 28) + '</span>' +
        '<span class="tile-name">' + d.name + '</span>' +
        '<span class="tile-state">' + label + '</span></div>';
    }
    return '';
  }

  function summary() {
    if (!D.devices.length) {
      var M0 = D.music || {};
      return '<div class="sum sum--empty"><span class="label">Lights &amp; home</span><b class="serif">Nothing connected yet</b><small>Add lights in Admin → Lights &amp; Home and link each one to a HomeKit Shortcut.</small></div>' +
        '<button class="sum" data-go-music><span class="label">Music</span><b class="num">' + (M0.playing ? 'Playing' : M0.connected ? 'Paused' : 'Off') + '</b><small>' + App.esc(M0.device ? M0.device.name : 'Spotify') + '</small></button>';
    }
    var lights = D.devices.filter(function (d) { return d.type === 'light' && d.on; });
    var unlocked = D.devices.filter(function (d) { return d.type === 'lock' && !d.locked; });
    var garage = garageDev();
    var secure = !unlocked.length && garage.state === 'closed';
    var c = D.climate, m = D.music || {};
    return '<button class="sum' + (lights.length ? ' sum--warm' : '') + '" data-sum="lights"><span class="label">Lights</span><b class="num">' + lights.length + '</b><small>on in ' + unique(lights.map(function (l) { return l.room; })).length + ' rooms</small></button>' +
      '<button class="sum' + (secure ? '' : ' sum--warn') + '" data-sum="security"><span class="label">Security</span><b class="num">' + (secure ? 'Locked' : unlocked.length + (garage.state !== 'closed' ? 1 : 0)) + '</b><small>' + (secure ? 'All doors + garage' : (garage.state !== 'closed' ? 'Garage ' + garage.state : '') + (unlocked.length ? (garage.state !== 'closed' ? ' · ' : '') + unlocked.map(function (u) { return u.name; }).join(', ') : '') + (secure ? '' : ' open')) + '</small></button>' +
      (c.enabled ? '<button class="sum" data-sum="climate"><span class="label">Climate</span><b class="num">' + c.current + '°</b><small>' + (c.mode === 'off' ? 'System off' : (c.set > c.current ? 'Heating' : c.set < c.current ? 'Cooling' : 'Holding') + ' to ' + c.set + '°') + '</small></button>' : '') +
      '<button class="sum" data-go-music><span class="label">Music</span><b class="num">' + (m.playing ? 'Playing' : m.connected ? 'Paused' : 'Off') + '</b><small>' + App.esc(m.device ? m.device.name : 'Spotify') + '</small></button>';
  }
  function unique(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }

  function scenes() {
    return D.scenes.map(function (s) {
      return '<button class="scene' + (V.scene === s.id ? ' is-on' : '') + '" data-scene="' + s.id + '">' + App.icon(s.icon, 26) + '<span>' + s.name + '</span></button>';
    }).join('');
  }

  function roomCount(room) {
    var on = D.devices.filter(function (d) { return d.room === room && d.type === 'light' && d.on; }).length;
    return on ? on + ' on' : 'All off';
  }
  function rooms() {
    if (!D.devices.length) return '';
    return D.rooms.map(function (r) {
      var list = D.devices.filter(function (d) { return d.room === r.id; });
      var on = list.filter(function (d) { return d.type === 'light' && d.on; }).length;
      return '<section class="room"><div class="room-h"><h3 class="serif">' + r.name + '</h3><span class="label" data-room-count="' + r.id + '">' + roomCount(r.id) + '</span></div>' +
        (list.length ? '<div class="tiles">' + list.map(tile).join('') + '</div>' : '<p class="room-empty">No devices yet</p>') + '</section>';
    }).join('');
  }

  function climate() {
    var c = D.climate;
    var verb = c.mode === 'off' ? 'Off' : c.set > c.current ? 'Heating' : c.set < c.current ? 'Cooling' : 'Holding';
    return '<div class="label label--light">Climate · Main floor</div>' +
      '<div class="th-main"><button class="th-btn" data-temp="-0.5" aria-label="Cooler">' + App.icon('minus', 36) + '</button>' +
      '<div class="th-set"><span class="num">' + c.set.toFixed(1).replace('.0', '') + '°</span><small>Set to</small></div>' +
      '<button class="th-btn" data-temp="0.5" aria-label="Warmer">' + App.icon('plus', 36) + '</button></div>' +
      '<div class="th-now"><span><b class="num">' + c.current + '°</b> inside</span><span class="th-verb th-verb--' + verb.toLowerCase() + '">' + verb + '</span><span><b class="num">' + c.humidity + '%</b> humidity</span></div>' +
      '<div class="seg seg--dark">' + [['heat', 'Heat'], ['cool', 'Cool'], ['auto', 'Auto'], ['off', 'Off']].map(function (m) {
        return '<button class="' + (c.mode === m[0] ? 'is-on' : '') + '" data-tmode="' + m[0] + '">' + m[1] + '</button>';
      }).join('') + '</div>';
  }

  function cams() {
    return '<div class="label">Cameras · snapshots every 20s</div><div class="cams">' + D.cameras.slice(0, 2).map(function (c) {
      return '<button class="cam" data-cam="' + c.id + '"><img src="' + (c.url || App.img(c.seed, 400, 250)) + '" alt=""><span class="cam-name">' + c.name + '</span><span class="cam-age">' + V.camAge + 's ago</span></button>';
    }).join('') + '</div>';
  }

  function media() {
    var m = D.music || {};
    if (!m.connected || !m.title) {
      return '<span class="np-art"></span><div class="np-text"><span class="label">Music</span><b>' + (m.connected ? 'Nothing playing' : 'Spotify not connected') + '</b><span>Tap to open Music</span></div>';
    }
    return '<img class="np-art" src="' + App.esc(m.art || '') + '" alt="">' +
      '<div class="np-text"><span class="label">' + App.esc(m.device ? m.device.name : 'Spotify') + '</span><b>' + App.esc(m.title) + '</b><span>' + App.esc(m.artist || '') + '</span></div>' +
      '<button class="np-btn" data-mplay aria-label="Play/Pause">' + App.icon(m.playing ? 'pause' : 'play', 30) + '</button>';
  }


  // Granular updates: an action repaints only what it touched (full paint() rebuilds ~270 nodes,
  // which costs ~350ms on the wall tablet).
  function paintTile(id) {
    var d = dev(id);
    if (!d) return;
    [V.el && V.el.querySelector('.hc-rooms'), V.sheetBox].forEach(function (root) {
      var old = root && root.querySelector('[data-dev="' + id + '"]');
      if (!old) return;
      var tmp = document.createElement('div');
      tmp.innerHTML = tile(d);
      var nt = tmp.firstChild;
      old.parentNode.replaceChild(nt, old);
      bindTile(nt);
    });
    var c = V.el && V.el.querySelector('[data-room-count="' + d.room + '"]');
    if (c) c.textContent = roomCount(d.room);
  }
  function paintPart(sel, html) { if (V.el) V.el.querySelector(sel).innerHTML = html; }
  function changed(ids) {
    ids.forEach(paintTile);
    paintPart('.hc-sum', summary());
    App.emit('data');
  }

  function paint() {
    if (!V.el) return;
    var el = V.el;
    el.querySelector('.hc-sum').innerHTML = summary();
    el.querySelector('.hc-scenes').innerHTML = scenes();
    var rs = el.querySelector('.hc-rooms'), st = rs.scrollTop;
    rs.innerHTML = rooms();
    rs.scrollTop = st;
    bindTiles(rs);
    var cl = el.querySelector('.hc-climate');
    cl.style.display = D.climate && D.climate.enabled ? '' : 'none';
    if (D.climate && D.climate.enabled) cl.innerHTML = climate();
    el.querySelector('.hc-cams').style.display = D.cameras.length ? '' : 'none';
    el.querySelector('.hc-media').innerHTML = media();
    paintTv();
  }
  function paintTv() {
    if (!V.el) return;
    var box = V.el.querySelector('.hc-tv'), html = tvCard();
    box.style.display = html ? '' : 'none';
    box.innerHTML = html;
  }

  // ------------------------------------------------------------ tile gestures
  // Lights + blinds: tap toggles, horizontal drag sets level (whole tile is the slider).
  function sliderTile(t, d) {
    var sx, startLvl, dragging = false, w;
    t.addEventListener('pointerdown', function (e) {
      sx = e.clientX; dragging = false; w = t.getBoundingClientRect().width;
      startLvl = d.type === 'light' ? (d.on ? d.level : 0) : d.pos;
      try { t.setPointerCapture(e.pointerId); } catch (err) {}
    });
    t.addEventListener('pointermove', function (e) {
      if (sx == null) return;
      var dx = e.clientX - sx;
      if (!dragging && Math.abs(dx) > 10) { dragging = true; t.classList.add('is-drag'); }
      if (!dragging) return;
      var lvl = Math.max(0, Math.min(100, Math.round(startLvl + dx / w * 100)));
      t.style.setProperty('--lvl', lvl + '%');
      t.classList.toggle('is-on', lvl > 0);
      t.querySelector('.tile-state').textContent = d.type === 'light' ? (lvl ? lvl + '%' : 'Off') : (lvl === 0 ? 'Closed' : lvl === 100 ? 'Open' : lvl + '% open');
      t._lvl = lvl;
    });
    t.addEventListener('pointerup', function () {
      if (sx == null) return;
      sx = null;
      t.classList.remove('is-drag');
      V.scene = null;
      if (dragging) {
        var lvl = t._lvl;
        if (d.type === 'light') App.setDevice(d.id, lvl ? { on: true, level: lvl } : { on: false });
        else App.setDevice(d.id, { pos: lvl });
      } else if (d.type === 'light') App.setDevice(d.id, { on: !d.on, level: d.level || 100 });
      else App.setDevice(d.id, { pos: d.pos > 0 ? 0 : 100 });
    });
    t.addEventListener('pointercancel', function () { sx = null; t.classList.remove('is-drag'); paintTile(d.id); });
  }

  function bindTiles(root) { App.$$('[data-dev]', root).forEach(bindTile); }
  function bindTile(t) {
    (function () {
      var d = dev(t.dataset.dev);
      var more = t.querySelector('.tile-more');
      if (more) {
        ['pointerdown', 'pointerup', 'pointermove'].forEach(function (ev) { more.addEventListener(ev, function (e) { e.stopPropagation(); }); });
        more.addEventListener('click', function (e) { e.stopPropagation(); App.lightSheet(d.id); });
      }
      if (d.type === 'light' || d.type === 'blind') sliderTile(t, d);
      if (d.type === 'lock') {
        App.hold(t, 1000, {
          enabled: function () { return d.locked; },
          done: function () { V.lastHold = Date.now(); App.setDevice(d.id, { locked: false }); App.toast('<b>' + d.name + '</b> unlocked', { icon: 'unlock' }); },
          cancel: function () { App.toast('Hold for a second to unlock <b>' + d.name + '</b>', { icon: 'lock', ms: 2200 }); }
        });
        t.addEventListener('click', function () { if (!d.locked && Date.now() - (V.lastHold || 0) > 800) App.setDevice(d.id, { locked: true }); });
      }
      if (d.type === 'garage') t.addEventListener('click', function () { App.openGarageSheet(); });
    })();
  }

  // Slide-to-confirm for the garage
  App.openGarageSheet = function () {
    var g = garageDev(), opening = g.state === 'closed';
    App.sheet('<div class="sheet-pad"><div class="label">Garage door · currently ' + g.state + '</div><h2 class="serif sheet-h">' + (opening ? 'Open' : 'Close') + ' the garage?</h2>' +
      '<p class="sheet-p">' + (opening ? 'Make sure the driveway is clear.' : 'The door will stop and reverse if anything is in the way.') + '</p>' +
      '<div class="slide-confirm"><span class="sc-label">Slide to ' + (opening ? 'open' : 'close') + ' →</span><span class="sc-fill"></span><span class="sc-knob">' + App.icon('garage', 30) + '</span></div></div>', {
      onMount: function (s, close) {
        var track = s.querySelector('.slide-confirm'), knob = s.querySelector('.sc-knob'), fill = s.querySelector('.sc-fill');
        var sx = null, max;
        knob.addEventListener('pointerdown', function (e) {
          sx = e.clientX; max = track.getBoundingClientRect().width - knob.getBoundingClientRect().width - 8;
          knob.setPointerCapture(e.pointerId);
        });
        knob.addEventListener('pointermove', function (e) {
          if (sx == null) return;
          var k = App.$('#stage').getBoundingClientRect().width / 1280;
          var x = Math.max(0, Math.min(max / k, (e.clientX - sx) / k));
          knob.style.transform = 'translateX(' + x + 'px)';
          fill.style.width = (x + 76) + 'px';
          knob._x = x; knob._max = max / k;
        });
        knob.addEventListener('pointerup', function () {
          if (sx == null) return;
          sx = null;

          if (knob._x >= knob._max - 6) {
            close();
            g.state = opening ? 'opening' : 'closing';
            V.scene = null;
            changed([g.id]);
            setTimeout(function () { g.state = opening ? 'open' : 'closed'; changed([g.id]); App.toast('Garage ' + g.state, { icon: 'garage', ms: 2500 }); }, 4000);
          } else { knob.style.transform = ''; fill.style.width = ''; }
        });
      }
    });
  };

  App.cameraSheet = function (c) {
    App.sheet('<div class="cam-big"><img src="' + (c.url || App.img(c.seed, 1200, 750)) + '" alt=""><div class="cam-big-bar"><span class="tk-live"><i></i>' + c.name + '</span><span class="label label--light">Snapshot · ' + V.camAge + 's ago</span></div></div>', { cls: 'sheet--cam' });
  };

  function listSheet(kind) {
    var list = D.devices.filter(function (d) { return kind === 'lights' ? d.type === 'light' : (d.type === 'lock' || d.type === 'garage'); });
    if (kind === 'lights') list.sort(function (a, b) { return b.on - a.on; });
    App.sheet('<div class="sheet-pad"><div class="label">' + (kind === 'lights' ? 'Every light in the house' : 'Doors + garage') + '</div>' +
      '<h2 class="serif sheet-h">' + (kind === 'lights' ? 'Lights' : 'Security') + '</h2>' +
      '<div class="tiles tiles--sheet">' + list.map(tile).join('') + '</div>' +
      '<div class="sheet-actions">' + (kind === 'lights' ? '<button class="btn btn--solid" data-alloff>Turn everything off</button>' : '<button class="btn btn--solid" data-lockall>Lock all doors</button>') + '</div></div>', {
      cls: 'sheet--wide',
      onClose: function () { V.sheetBox = null; },
      onMount: function (s, close) {
        var box = s.querySelector('.tiles--sheet');
        V.sheetBox = box;
        bindTiles(box);
        var off = s.querySelector('[data-alloff]'), lk = s.querySelector('[data-lockall]');
        if (off) off.onclick = function () {
          var prev = D.devices.filter(function (d) { return d.type === 'light' && d.on; });
          prev.forEach(function (d) { d.on = false; });
          close(); changed(prev.map(function (d) { return d.id; }));
          App.toast('Turned off ' + prev.length + ' lights', { icon: 'bulb', undo: function () { prev.forEach(function (d) { d.on = true; }); changed(prev.map(function (d) { return d.id; })); } });
        };
        if (lk) lk.onclick = function () {
          var locks = D.devices.filter(function (d) { return d.type === 'lock'; });
          locks.forEach(function (d) { d.locked = true; });
          close(); changed(locks.map(function (d) { return d.id; }));
          App.toast('All doors locked', { icon: 'lock' });
        };
      }
    });
  }

  function applyScene(id) {
    var s = D.scenes.filter(function (x) { return x.id === id; })[0];
    var snapshot = D.devices.map(function (d) { return Object.assign({}, d); });
    var prevScene = V.scene;
    Object.keys(s.set).forEach(function (k) {
      var d = dev(k), v = s.set[k];
      if (!d) return;
      if (d.type === 'blind') d.pos = v;
      else if (v === 0) d.on = false;
      else { d.on = true; d.level = v; }
    });
    if (id === 'away' || id === 'night') D.devices.forEach(function (d) { if (d.type === 'lock') d.locked = true; });
    V.scene = id;
    if (window.HQ && HQ.scene) HQ.scene(id);
    function diff() {
      return snapshot.filter(function (o) { var d = dev(o.id); return o.on !== d.on || o.level !== d.level || o.pos !== d.pos || o.locked !== d.locked; })
        .map(function (o) { return o.id; });
    }
    var ids = diff();
    paintPart('.hc-scenes', scenes());
    changed(ids);
    App.toast('<b>' + s.name + '</b> scene on', {
      icon: s.icon, undo: function () {
        snapshot.forEach(function (o) { Object.assign(dev(o.id), o); });
        V.scene = prevScene;
        paintPart('.hc-scenes', scenes());
        changed(ids);
      }
    });
  }

  function onClick(e) {
    var t;
    if ((t = e.target.closest('[data-scene]'))) return applyScene(t.dataset.scene);
    if ((t = e.target.closest('[data-tv]'))) return App.tvKey(t.dataset.tv);
    if (e.target.closest('[data-tv-power]')) { var T = D.tv || {}; return post('/api/home/tv/power', { on: T.power === 'off' }).catch(function (er) { App.toast(App.esc(er.message), { tone: 'error', icon: 'film' }); }); }
    if (e.target.closest('[data-tv-apps]')) return App.tvApps();
    if ((t = e.target.closest('[data-sum]'))) {
      var k = t.dataset.sum;
      if (k === 'lights' || k === 'security') return listSheet(k);
      var target = V.el.querySelector(k === 'climate' ? '.hc-climate' : '.hc-media');
      target.classList.add('is-pulse'); setTimeout(function () { target.classList.remove('is-pulse'); }, 900);
      return;
    }
    if ((t = e.target.closest('[data-temp]'))) {
      D.climate.set = Math.max(15, Math.min(28, D.climate.set + +t.dataset.temp));
      if (D.climate.mode === 'off') D.climate.mode = 'heat';
      return climateChanged();
    }
    if ((t = e.target.closest('[data-tmode]'))) { D.climate.mode = t.dataset.tmode; return climateChanged(); }
    if ((t = e.target.closest('[data-cam]'))) return App.cameraSheet(D.cameras.filter(function (c) { return c.id === t.dataset.cam; })[0]);
    if ((t = e.target.closest('[data-mplay]'))) { e.stopPropagation(); App.musicCmd((D.music || {}).playing ? 'pause' : 'play'); return; }
    if (e.target.closest('[data-go-music]') || e.target.closest('.hc-media')) { App.go('music'); }
  }
  function climateChanged() { paintPart('.hc-climate', climate()); paintPart('.hc-sum', summary()); App.emit('data'); }

  function camTimer() {
    clearInterval(V.camTimer);
    V.camTimer = setInterval(function () {
      V.camAge = V.camAge >= 20 ? 1 : V.camAge + 1;
      App.$$('.cam-age', V.el).forEach(function (a) { a.textContent = V.camAge + 's ago'; });
    }, 1000);
  }

  App.on('live', function (keys) {
    if (V.el && keys.indexOf('tv') > -1) paintTv();
    if (!V.el || keys.indexOf('music') < 0) return;
    paintPart('.hc-media', media()); paintPart('.hc-sum', summary());
  });

  App.register('control', {
    show: function (el) {
      if (!V.el) {
        V.el = el;
        el.innerHTML = '<div class="hc">' +
          '<div class="hc-left"><div class="hc-sum"></div><div class="hc-scenes"></div><div class="hc-rooms"></div></div>' +
          '<div class="hc-right"><div class="hc-climate"></div><div class="hc-tv card"></div><div class="hc-cams"></div><div class="hc-media card"></div></div>' +
          '</div>';
        el.addEventListener('click', onClick);
      }
      el.querySelector('.hc-cams').innerHTML = cams();
      paint();
      camTimer();
    },
    resume: function () { camTimer(); },
    hide: function () { clearInterval(V.camTimer); }
  });
})();
