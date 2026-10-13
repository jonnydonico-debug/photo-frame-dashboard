// Map: search a place (or tap the map) to see walking and driving distance from home.
(function () {
  'use strict';
  var D = window.DATA;
  var V = { el: null, map: null, layers: null, dest: null, routes: null, mode: 'drive', seq: 0 };
  var BART = [
    { name: 'El Cerrito Plaza BART', lat: 37.902632, lon: -122.298904 },
    { name: 'El Cerrito del Norte BART', lat: 37.925086, lon: -122.316794 }
  ];

  function home() { var s = D.settings || {}; return s.lat != null ? { lat: s.lat, lon: s.lon, label: s.address } : null; }
  function get(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) { return r.text().then(function (t) { var j = {}; try { j = JSON.parse(t); } catch (e) {} if (!r.ok) throw new Error(j.error || 'Couldn’t reach the Mac mini'); return j; }); });
  }
  function pin(cls, html) {
    return window.L.divIcon({ className: 'mp-pin ' + cls, html: '<i>' + (html || '') + '</i>', iconSize: [34, 34], iconAnchor: [17, 34] });
  }

  function initMap() {
    var L = window.L, h = home();
    if (!L || V.map) return !!V.map;
    var box = V.el.querySelector('.mp-map');
    V.map = L.map(box, { zoomControl: false, attributionControl: true, tap: true }).setView(h ? [h.lat, h.lon] : [37.9161, -122.3108], 14);
    // OpenStreetMap's own tiles: free, no key (CARTO started requiring one).
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OpenStreetMap contributors', className: 'mp-tiles'
    }).addTo(V.map);
    L.control.zoom({ position: 'bottomright' }).addTo(V.map);
    // Live traffic on the roads (TomTom, through the Mac mini so the key stays private)
    V.traffic = L.tileLayer('/api/geo/traffic/{z}/{x}/{y}.png?t={t}', { maxZoom: 19, maxNativeZoom: 18, opacity: .95, zIndex: 5, t: Date.now(), className: 'mp-traffic' });
    syncTraffic();
    V.layers = L.layerGroup().addTo(V.map);
    V.fixed = L.layerGroup().addTo(V.map);
    V.map.on('click', function (e) { setDest({ name: 'Dropped pin', label: e.latlng.lat.toFixed(5) + ', ' + e.latlng.lng.toFixed(5), lat: e.latlng.lat, lon: e.latlng.lng }, true); });
    drawFixed();
    return true;
  }
  function trafficOn() { return !!(D.settings && D.settings.traffic); }
  function wantTraffic() { try { return localStorage.getItem('hq.map.traffic') !== '0'; } catch (e) { return true; } }
  function syncTraffic() {
    if (!V.map || !V.traffic) return;
    var show = trafficOn() && wantTraffic();
    if (show && !V.map.hasLayer(V.traffic)) V.traffic.addTo(V.map);
    if (!show && V.map.hasLayer(V.traffic)) V.map.removeLayer(V.traffic);
    var b = V.el.querySelector('[data-traffic]');
    if (b) { b.hidden = !trafficOn(); b.classList.toggle('is-on', show); }
  }
  function drawFixed() {
    var L = window.L, h = home();
    V.fixed.clearLayers();
    if (h) L.marker([h.lat, h.lon], { icon: pin('mp-pin--home', App.icon('home', 18)) }).addTo(V.fixed);
    BART.forEach(function (b) {
      L.marker([b.lat, b.lon], { icon: pin('mp-pin--bart', App.icon('train', 16)) }).addTo(V.fixed)
        .on('click', function () { setDest(b, false); });
    });
  }

  function setDest(d, keepView) {
    var h = home(), L = window.L;
    V.dest = d; V.routes = null;
    V.layers.clearLayers();
    L.marker([d.lat, d.lon], { icon: pin('mp-pin--dest') }).addTo(V.layers);
    if (!keepView) V.map.setView([d.lat, d.lon], 15);
    paintCard();
    if (!h) return;
    var my = ++V.seq;
    get('/api/geo/route?lat=' + d.lat + '&lon=' + d.lon).then(function (r) {
      if (my !== V.seq) return;
      V.routes = r; drawRoute(); paintCard();
    }).catch(function (e) { if (my === V.seq) { V.routes = { error: e.message }; paintCard(); } });
  }
  var JAM = ['#C88F3E', '#E0A33B', '#D9732B', '#C0392B', '#7A1F1F']; // by TomTom's magnitudeOfDelay 0–4
  function drawRoute(noFit) {
    var L = window.L, r = V.routes, h = home();
    V.layers.eachLayer(function (l) { if (l instanceof L.Polyline) V.layers.removeLayer(l); });
    if (!r) return;
    var m = r[V.mode] && !r[V.mode].error ? V.mode : (V.mode === 'drive' ? 'walk' : 'drive');
    var other = m === 'drive' ? 'walk' : 'drive';
    if (r[other] && r[other].line) L.polyline(r[other].line, { color: '#7A756B', weight: 4, opacity: .45, dashArray: '6 8' }).addTo(V.layers);
    if (r[m] && r[m].line) {
      var line = L.polyline(r[m].line, { color: m === 'drive' ? '#A8644A' : '#5F7D57', weight: 7, opacity: .9 }).addTo(V.layers);
      // Slow stretches on the drive, coloured by how bad the delay is
      if (m === 'drive' && r.drive.traffic) r.drive.traffic.forEach(function (t) {
        var seg = r.drive.line.slice(t.from, t.to + 1);
        if (seg.length > 1) L.polyline(seg, { color: JAM[Math.max(1, Math.min(4, t.mag))], weight: 9, opacity: .95, lineCap: 'round' }).addTo(V.layers);
      });
      if (!noFit) V.map.fitBounds(line.getBounds().extend([h.lat, h.lon]), { paddingTopLeft: [440, 40], paddingBottomRight: [40, 40] });
    }
  }

  function trip(kind) {
    var r = V.routes, t = r && r[kind];
    var label = kind === 'drive' ? 'Drive' : 'Walk';
    if (!r) return '<button class="mp-trip" disabled>' + App.icon(kind === 'drive' ? 'car' : 'walk', 30) + '<span><small>' + label + '</small><b>…</b></span></button>';
    if (!t || t.error) return '<button class="mp-trip" disabled>' + App.icon(kind === 'drive' ? 'car' : 'walk', 30) + '<span><small>' + label + '</small><b>–</b></span></button>';
    return '<button class="mp-trip' + (V.mode === kind ? ' is-on' : '') + '" data-mode="' + kind + '">' + App.icon(kind === 'drive' ? 'car' : 'walk', 30) +
      '<span><small>' + label + (t.live ? ' · live traffic' : '') + '</small><b class="num">' + App.fmt.mins(t.min) + '</b><em>' + t.mi + ' mi' +
      (t.live ? (t.delay > 0 ? ' · <i class="mp-delay">+' + App.fmt.mins(t.delay) + ' traffic</i>' : ' · no delays') : '') + '</em></span></button>';
  }
  function paintCard() {
    var c = V.el.querySelector('.mp-card'), d = V.dest;
    if (!home()) {
      c.innerHTML = '<div class="label">Distances</div><p class="mp-p">Add your home address in Admin → Settings, then search for anywhere to see how far it is.</p>';
      return;
    }
    if (!d) {
      c.innerHTML = '<div class="label">From home</div><p class="mp-p">Search for a place, tap a BART pin, or tap anywhere on the map.</p>';
      return;
    }
    c.innerHTML = '<div class="label">From home to</div><h2 class="serif mp-h">' + App.esc(d.name) + '</h2>' +
      (d.label && d.label !== d.name ? '<p class="mp-addr">' + App.esc(d.label) + '</p>' : '') +
      (V.routes && V.routes.error ? '<p class="mp-p">' + App.esc(V.routes.error) + '</p>' : '<div class="mp-trips">' + trip('drive') + trip('walk') + '</div>');
  }

  function results(list) {
    var box = V.el.querySelector('.mp-results');
    if (!list) { box.innerHTML = ''; box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = list.length ? list.map(function (x, i) {
      return '<button class="mp-res" data-res="' + i + '"><b>' + App.esc(x.name) + '</b><small>' + App.esc(x.label) + '</small></button>';
    }).join('') : '<p class="mp-p">Nothing found.</p>';
    box._list = list;
  }

  App.register('map', {
    show: function (el) {
      if (!V.el) {
        V.el = el;
        el.innerHTML = '<div class="mp"><div class="mp-map"></div>' +
          '<div class="mp-panel">' +
          '  <form class="mp-search"><span>' + App.icon('search', 24) + '</span><input type="search" placeholder="Where to?" enterkeyhint="search"><button type="button" class="mp-x" data-clear aria-label="Clear">' + App.icon('x', 22) + '</button></form>' +
          '  <div class="mp-results" hidden></div>' +
          '  <div class="mp-card card"></div>' +
          '  <div class="mp-quick">' + BART.map(function (b, i) { return '<button class="chip" data-bart="' + i + '">' + App.icon('train', 18) + ' ' + b.name.replace(' BART', '') + '</button>'; }).join('') +
          '<button class="chip mp-tbtn" data-traffic hidden>' + App.icon('car', 18) + ' Traffic</button></div>' +
          '</div>' +
          '<div class="mp-off" hidden>Map needs an internet connection.</div></div>';
        var input = el.querySelector('.mp-search input');
        el.querySelector('.mp-search').addEventListener('submit', function (e) {
          e.preventDefault();
          var q = input.value.trim(); if (!q) return;
          input.blur();
          V.el.querySelector('.mp-results').hidden = false;
          V.el.querySelector('.mp-results').innerHTML = '<p class="mp-p">Searching…</p>';
          get('/api/geo/search?q=' + encodeURIComponent(q)).then(results).catch(function (e2) { results([]); App.toast(App.esc(e2.message), { tone: 'error', icon: 'map' }); });
        });
        el.addEventListener('click', function (e) {
          var t;
          if ((t = e.target.closest('[data-res]'))) { var x = el.querySelector('.mp-results')._list[+t.dataset.res]; results(null); input.value = x.name; setDest(x, false); return; }
          if ((t = e.target.closest('[data-mode]'))) { V.mode = t.dataset.mode; drawRoute(); paintCard(); return; }
          if ((t = e.target.closest('[data-bart]'))) { setDest(BART[+t.dataset.bart], false); return; }
          if (e.target.closest('[data-traffic]')) { var on = !(wantTraffic()); try { localStorage.setItem('hq.map.traffic', on ? '1' : '0'); } catch (e3) {} syncTraffic(); return; }
          if (e.target.closest('[data-clear]')) { input.value = ''; results(null); V.dest = null; V.routes = null; if (V.layers) V.layers.clearLayers(); paintCard(); }
        });
      }
      if (!window.L) { el.querySelector('.mp-off').hidden = false; paintCard(); return; }
      initMap();
      setTimeout(function () { V.map.invalidateSize(); }, 50);
      paintCard();
    }
  });
  App.on('data', function () { if (V.map) { drawFixed(); syncTraffic(); } });
  // Keep traffic fresh while the Map tab is open: new tiles and a re-checked route every 2 minutes.
  setInterval(function () {
    if (App.current !== 'map' || !V.map || !trafficOn()) return;
    if (V.map.hasLayer(V.traffic)) { V.traffic.options.t = Date.now(); V.traffic.redraw(); }
    if (V.dest && home()) {
      var d = V.dest, my = V.seq;
      get('/api/geo/route?lat=' + d.lat + '&lon=' + d.lon).then(function (r) { if (my === V.seq && V.dest === d) { V.routes = r; drawRoute(true); paintCard(); } }).catch(function () {});
    }
  }, 120000);
})();
