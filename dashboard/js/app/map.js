// Map: search a place (or tap a BART station) to see driving and walking time from home, with live
// traffic — the same as the frame's Map tab. Leaflet loads the first time the screen opens.
(function () {
  'use strict';
  var D = window.DATA;
  var V = { map: null, layers: null, fixed: null, dest: null, routes: null, mode: 'drive', seq: 0, list: null, loading: null };
  var BART = [
    { name: 'El Cerrito Plaza BART', lat: 37.902632, lon: -122.298904 },
    { name: 'El Cerrito del Norte BART', lat: 37.925086, lon: -122.316794 }
  ];
  var JAM = ['#C88F3E', '#E0A33B', '#D9732B', '#C0392B', '#7A1F1F'];

  function home() { var s = D.settings || {}; return s.lat != null ? { lat: s.lat, lon: s.lon } : null; }
  function traffic() { return !!(D.settings && D.settings.traffic); }
  function loadLeaflet() {
    if (window.L) return Promise.resolve();
    if (V.loading) return V.loading;
    V.loading = new Promise(function (ok, fail) {
      var css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; document.head.appendChild(css);
      var js = document.createElement('script'); js.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'; js.onload = ok; js.onerror = function () { V.loading = null; fail(); };
      document.head.appendChild(js);
    });
    return V.loading;
  }
  function pin(cls, html) { return window.L.divIcon({ className: 'mp-pin ' + cls, html: '<i>' + (html || '') + '</i>', iconSize: [30, 30], iconAnchor: [15, 30] }); }

  function initMap(box) {
    var L = window.L, h = home();
    if (V.map) { if (V.map.getContainer() !== box) { V.map.remove(); V.map = null; } else return; }
    V.map = L.map(box, { zoomControl: false, attributionControl: true }).setView(h ? [h.lat, h.lon] : [37.9161, -122.3108], 13);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap', className: 'mp-tiles' }).addTo(V.map);
    if (traffic()) L.tileLayer('/api/geo/traffic/{z}/{x}/{y}.png?t={t}', { tileSize: 512, zoomOffset: -1, minZoom: 1, maxZoom: 19, maxNativeZoom: 18, opacity: .95, zIndex: 5, t: Date.now() }).addTo(V.map);
    V.fixed = L.layerGroup().addTo(V.map);
    V.layers = L.layerGroup().addTo(V.map);
    if (h) L.marker([h.lat, h.lon], { icon: pin('mp-pin--home', App.icon('home', 16)) }).addTo(V.fixed);
    BART.forEach(function (b) { L.marker([b.lat, b.lon], { icon: pin('mp-pin--bart', App.icon('train', 14)) }).addTo(V.fixed).on('click', function () { setDest(b); }); });
    V.map.on('click', function (e) { setDest({ name: 'Dropped pin', lat: e.latlng.lat, lon: e.latlng.lng }, true); });
  }

  function setDest(d, keepView) {
    V.dest = d; V.routes = null; V.list = null;
    if (V.layers) {
      V.layers.clearLayers();
      window.L.marker([d.lat, d.lon], { icon: pin('mp-pin--dest') }).addTo(V.layers);
      if (!keepView) V.map.setView([d.lat, d.lon], 14);
    }
    paint();
    if (!home()) return;
    var my = ++V.seq;
    App.get('/api/geo/route?lat=' + d.lat + '&lon=' + d.lon).then(function (r) { if (my === V.seq) { V.routes = r; draw(); paint(); } })
      .catch(function (e) { if (my === V.seq) { V.routes = { error: e.message }; paint(); } });
  }
  function draw() {
    var L = window.L, r = V.routes, h = home();
    if (!L || !V.layers || !r) return;
    V.layers.eachLayer(function (l) { if (l instanceof L.Polyline) V.layers.removeLayer(l); });
    var m = r[V.mode] && !r[V.mode].error ? V.mode : (V.mode === 'drive' ? 'walk' : 'drive'), other = m === 'drive' ? 'walk' : 'drive';
    if (r[other] && r[other].line) L.polyline(r[other].line, { color: '#807B71', weight: 4, opacity: .5, dashArray: '6 8' }).addTo(V.layers);
    if (r[m] && r[m].line) {
      var line = L.polyline(r[m].line, { color: m === 'drive' ? '#CDB66A' : '#8FB07A', weight: 6, opacity: .95 }).addTo(V.layers);
      if (m === 'drive' && r.drive.traffic) r.drive.traffic.forEach(function (t) {
        var seg = r.drive.line.slice(t.from, t.to + 1);
        if (seg.length > 1) L.polyline(seg, { color: JAM[Math.max(1, Math.min(4, t.mag))], weight: 8, opacity: .95 }).addTo(V.layers);
      });
      V.map.fitBounds(line.getBounds().extend([h.lat, h.lon]), { padding: [24, 24] });
    }
  }

  function trip(kind) {
    var r = V.routes, t = r && r[kind], label = kind === 'drive' ? 'Drive' : 'Walk';
    var ico = App.icon(kind === 'drive' ? 'car' : 'walk', 22);
    if (!r || !t || t.error) return '<button class="mp2-trip" disabled>' + ico + '<span><small>' + label + '</small><b>' + (r ? '–' : '…') + '</b></span></button>';
    return '<button class="mp2-trip' + (V.mode === kind ? ' is-on' : '') + '" data-mode="' + kind + '">' + ico + '<span><small>' + label + (t.live ? ' · live' : '') + '</small><b>' + App.fmt.mins(t.min) + '</b>' +
      '<em>' + t.mi + ' mi' + (t.live && t.delay > 0 ? ' · <i>+' + App.fmt.mins(t.delay) + '</i>' : '') + '</em></span></button>';
  }
  function card() {
    if (!home()) return '<div class="card"><p class="muted">Add your home address in Admin → Settings, then search anywhere to see how far it is.</p></div>';
    if (V.list) return '<div class="group">' + (V.list.length ? V.list.map(function (x, i) {
      return '<button class="menu-i" data-res="' + i + '"><span class="menu-ico">' + App.icon('pin', 18) + '</span><span><b>' + App.esc(x.name) + '</b><small>' + App.esc(x.label || '') + '</small></span></button>';
    }).join('') : '<p class="pad muted">Nothing found.</p>') + '</div>';
    if (!V.dest) return '<div class="card"><div class="card-h">From home</div><p class="muted">Search for a place, tap a BART pin, or tap anywhere on the map.</p></div>';
    return '<div class="card"><div class="card-h">From home to</div><h2 class="mp2-h">' + App.esc(V.dest.name) + '</h2>' +
      (V.dest.label && V.dest.label !== V.dest.name ? '<p class="muted">' + App.esc(V.dest.label) + '</p>' : '') +
      (V.routes && V.routes.error ? '<p class="muted">' + App.esc(V.routes.error) + '</p>' : '<div class="mp2-trips">' + trip('drive') + trip('walk') + '</div>') + '</div>';
  }
  function paint() { var c = App.$('.scr[data-scr="map"] .mp2-card'); if (c) c.innerHTML = card(); }

  App.screen('map', {
    tab: 'more',
    render: function (el) {
      // Repaints from live updates keep the map that's already there
      if (V.map && el.querySelector('.mp2-map')) return paint();
      el.innerHTML ='<button class="back" data-go="more">' + App.icon('left', 20) + 'More</button>' + App.head('Map', 'How far is it from home?') +
        '<form class="search mp2-search">' + App.icon('search', 18) + '<input type="search" placeholder="Where to?" enterkeyhint="search" value=""><button type="button" data-clear aria-label="Clear">' + App.icon('x', 14) + '</button></form>' +
        '<div class="chips mp2-quick">' + BART.map(function (b, i) { return '<button class="chip" data-bart="' + i + '">' + App.icon('train', 16) + b.name.replace(' BART', '') + '</button>'; }).join('') + '</div>' +
        '<div class="mp2-map"><p class="muted">Loading map…</p></div><div class="mp2-card">' + card() + '</div>';
      var box = el.querySelector('.mp2-map');
      loadLeaflet().then(function () {
        if (App.current !== 'map' || !box.isConnected) return;
        box.innerHTML = '';
        initMap(box);
        if (V.dest) { setDest(V.dest, false); }
        setTimeout(function () { if (V.map) V.map.invalidateSize(); }, 60);
      }).catch(function () { box.innerHTML = '<p class="muted">The map needs an internet connection.</p>'; });
      var input = el.querySelector('.mp2-search input');
      el.querySelector('.mp2-search').onsubmit = function (e) {
        e.preventDefault();
        var q = input.value.trim(); if (!q) return;
        input.blur(); V.list = []; paint();
        el.querySelector('.mp2-card').innerHTML = '<p class="pad muted">Searching…</p>';
        App.get('/api/geo/search?q=' + encodeURIComponent(q)).then(function (list) { V.list = list || []; paint(); })
          .catch(function (er) { V.list = null; paint(); App.toast(App.esc(er.message), { tone: 'error', icon: 'map' }); });
      };
      if (!el.dataset.wired) {
        el.dataset.wired = '1';
        el.addEventListener('click', function (e) {
          var t;
          if ((t = e.target.closest('[data-go]'))) return App.go(t.dataset.go);
          if ((t = e.target.closest('[data-res]'))) { var x = V.list[+t.dataset.res]; el.querySelector('.mp2-search input').value = x.name; return setDest(x); }
          if ((t = e.target.closest('[data-bart]'))) return setDest(BART[+t.dataset.bart]);
          if ((t = e.target.closest('[data-mode]'))) { V.mode = t.dataset.mode; draw(); return paint(); }
          if (e.target.closest('[data-clear]')) { el.querySelector('.mp2-search input').value = ''; V.list = null; V.dest = null; V.routes = null; if (V.layers) V.layers.clearLayers(); return paint(); }
        });
      }
    },
    leave: function () { if (V.map) { V.map.remove(); V.map = null; V.layers = null; V.fixed = null; } }
  });
})();
