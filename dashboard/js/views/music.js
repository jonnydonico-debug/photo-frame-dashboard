// Music: Spotify now playing, speakers (Spotify Connect), playlists and search.
(function () {
  'use strict';
  var D = window.DATA;
  var V = { el: null, lib: null, libAt: 0, results: null, q: '', volTimer: null };

  App.musicCmd = function (action, extra) {
    var M = D.music || {};
    var body = Object.assign({ action: action }, extra || {});
    // Optimistic play/pause so the button reacts instantly
    if (action === 'play' && !extra) { M.playing = true; M.at = Date.now(); App.emit('live', ['music']); }
    if (action === 'pause') { M.progress = M.progress + (Date.now() - (M.at || Date.now())); M.at = Date.now(); M.playing = false; App.emit('live', ['music']); }
    return fetch('/api/music', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-HQ': '1' }, body: JSON.stringify(body) })
      .then(function (r) { return r.text().then(function (t) { var j = {}; try { j = JSON.parse(t); } catch (e) {} if (!r.ok) throw new Error(j.error || 'Spotify didn’t respond'); return j; }); })
      .catch(function (e) {
        var msg = /no active device|NO_ACTIVE_DEVICE|404/i.test(e.message) ? 'Pick a speaker first' : e.message;
        App.toast(App.esc(msg), { tone: 'error', icon: 'music', ms: 3500 });
        if (/speaker/.test(msg)) openSpeakers();
      });
  };

  function get(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) { return r.text().then(function (t) { var j = {}; try { j = JSON.parse(t); } catch (e) {} if (!r.ok) throw new Error(j.error || 'Couldn’t reach the Mac mini'); return j; }); });
  }

  // ------------------------------------------------------------ parts
  function nowPlaying() {
    var M = D.music || {};
    if (!M.connected) {
      return '<div class="mu-empty"><span class="mu-empty-icon">' + App.icon('music', 64) + '</span>' +
        '<h2 class="serif">Connect Spotify</h2><p>Open Admin → Music on your phone and sign in to Spotify. Then pick a playlist here and play it on any of your speakers.</p></div>';
    }
    var dev = M.device;
    return (M.title && M.art ? '<img class="mu-art" src="' + App.esc(M.art) + '" alt="">' : '<div class="mu-art mu-art--none">' + App.icon('music', 72) + '</div>') +
      '<div class="mu-meta"><b>' + App.esc(M.title || 'Nothing playing') + '</b><span>' + App.esc(M.title ? M.artist : 'Pick a playlist or search') + '</span></div>' +
      '<div class="mu-prog"><i style="width:' + (App.musicProgress ? App.musicProgress(M) : 0) + '%"></i></div>' +
      '<div class="mu-ctl">' +
      '<button class="mu-sm' + (M.shuffle ? ' is-on' : '') + '" data-mcmd="shuffle" aria-label="Shuffle">' + App.icon('shuffle', 26) + '</button>' +
      '<button data-mcmd="prev" aria-label="Previous">' + App.icon('prev', 34) + '</button>' +
      '<button class="mu-play" data-mcmd="' + (M.playing ? 'pause' : 'play') + '" aria-label="Play or pause">' + App.icon(M.playing ? 'pause' : 'play', 40) + '</button>' +
      '<button data-mcmd="next" aria-label="Next">' + App.icon('next', 34) + '</button>' +
      '<button class="mu-sm" data-speakers aria-label="Speakers">' + App.icon('speaker', 26) + '</button></div>' +
      '<button class="mu-dev" data-speakers>' + App.icon('speaker', 20) + '<span>' + (dev ? 'Playing on <b>' + App.esc(dev.name) + '</b>' : 'Choose a speaker') + '</span></button>' +
      (dev && dev.volume != null ? '<label class="mu-vol">' + App.icon('speaker', 20) + '<input type="range" min="0" max="100" step="2" value="' + dev.volume + '" data-vol></label>' : '');
  }
  function tile(x) {
    return '<button class="mu-tile" data-uri="' + App.esc(x.uri) + '">' +
      (x.art ? '<img src="' + App.esc(x.art) + '" alt="" loading="lazy">' : '<span class="mu-tile-ph">' + App.icon('music', 30) + '</span>') +
      '<b>' + App.esc(x.name) + '</b><small>' + App.esc(x.by || '') + '</small></button>';
  }
  function row(x) {
    return '<button class="mu-row" data-uri="' + App.esc(x.uri) + '">' + (x.art ? '<img src="' + App.esc(x.art) + '" alt="">' : '<span></span>') +
      '<span><b>' + App.esc(x.name) + '</b><small>' + App.esc(x.by || '') + '</small></span>' + App.icon('play', 22) + '</button>';
  }
  function browse() {
    var M = D.music || {};
    if (!M.connected) return '';
    var R = V.results;
    if (R) {
      var all = (R.tracks || []).length + (R.playlists || []).length + (R.albums || []).length + (R.artists || []).length;
      if (!all) return '<p class="mu-note">No results for “' + App.esc(V.q) + '”.</p>';
      return (R.tracks.length ? '<div class="label">Songs</div><div class="mu-rows">' + R.tracks.slice(0, 4).map(row).join('') + '</div>' : '') +
        '<div class="label">Playlists, albums + artists</div><div class="mu-tiles">' + R.playlists.slice(0, 3).concat(R.albums.slice(0, 3), R.artists.slice(0, 2)).map(tile).join('') + '</div>';
    }
    if (!V.lib) return '<p class="mu-note">Loading your playlists…</p>';
    if (V.lib.error) return '<p class="mu-note">' + App.esc(V.lib.error) + '</p>';
    return (V.lib.recentTracks && V.lib.recentTracks.length ? '<div class="label">Recently played</div><div class="mu-rows mu-rows--2">' + V.lib.recentTracks.slice(0, 4).map(row).join('') + '</div>' : '') +
      '<div class="label">Your playlists</div><div class="mu-tiles">' + V.lib.playlists.map(tile).join('') + '</div>';
  }

  function paintNow() { if (V.el) V.el.querySelector('.mu-now').innerHTML = nowPlaying(); }
  function paintBrowse() { if (V.el) V.el.querySelector('.mu-browse').innerHTML = browse(); }
  function paint() {
    paintNow(); paintBrowse();
    var M = D.music || {};
    V.el.querySelector('.mu-search').style.display = M.connected ? '' : 'none';
  }

  function loadLibrary(force) {
    if (!(D.music || {}).connected) return;
    if (!force && V.lib && Date.now() - V.libAt < 5 * 60000) return;
    V.libAt = Date.now();
    get('/api/music/library').then(function (j) { V.lib = j; paintBrowse(); })
      .catch(function (e) { V.lib = { error: e.message, playlists: [] }; paintBrowse(); });
  }

  // ------------------------------------------------------------ speakers sheet
  function openSpeakers() {
    var M = D.music || {};
    var list = M.devices || [];
    App.sheet('<div class="sheet-pad"><div class="label">Spotify Connect</div><h2 class="serif sheet-h">Play on…</h2>' +
      (list.length ? '<div class="mu-devs">' + list.map(function (d) {
        return '<button class="mu-devrow' + (d.active ? ' is-on' : '') + '" data-dev="' + App.esc(d.id) + '"' + (d.restricted ? ' disabled' : '') + '>' +
          App.icon('speaker', 28) + '<span><b>' + App.esc(d.name) + '</b><small>' + App.esc(d.type) + (d.active ? ' · playing' : '') + '</small></span></button>';
      }).join('') + '</div>' :
        '<p class="sheet-p">No speakers found. Open Spotify on a speaker, phone or the Mac mini so it shows up, then try again.</p>') +
      '<p class="mu-note">Speakers appear here when Spotify can see them: Sonos, Echo, Google, smart TVs, and any phone or computer with Spotify open.</p></div>', {
      cls: 'sheet--wide',
      onMount: function (s, close) {
        s.addEventListener('click', function (e) {
          var b = e.target.closest('[data-dev]');
          if (!b) return;
          close();
          App.toast('Moving music to <b>' + App.esc(b.querySelector('b').textContent) + '</b>', { icon: 'speaker', ms: 2500 });
          App.musicCmd('transfer', { device: b.dataset.dev });
        });
      }
    });
  }
  App.openSpeakers = openSpeakers;

  // ------------------------------------------------------------ view
  var searchTimer = null;
  App.register('music', {
    show: function (el) {
      if (!V.el) {
        V.el = el;
        el.innerHTML = '<div class="mu">' +
          '<section class="mu-now card"></section>' +
          '<section class="mu-side">' +
          '  <div class="mu-search"><span>' + App.icon('search', 24) + '</span><input type="search" placeholder="Search songs, artists, playlists" enterkeyhint="search"><button class="mu-clear" data-clear aria-label="Clear">' + App.icon('x', 22) + '</button></div>' +
          '  <div class="mu-browse"></div>' +
          '</section></div>';
        el.addEventListener('click', function (e) {
          var t;
          if ((t = e.target.closest('[data-mcmd]'))) {
            var a = t.dataset.mcmd;
            if (a === 'shuffle') return App.musicCmd('shuffle', { on: !(D.music || {}).shuffle });
            return App.musicCmd(a);
          }
          if (e.target.closest('[data-speakers]')) return openSpeakers();
          if ((t = e.target.closest('[data-uri]'))) {
            var M = D.music || {};
            var dev = M.device ? null : ((M.devices || []).filter(function (d) { return !d.restricted; })[0] || null);
            if (!M.device && !dev) return openSpeakers();
            App.toast('Playing <b>' + App.esc(t.querySelector('b').textContent) + '</b>', { icon: 'music', ms: 2200 });
            return App.musicCmd('play', { uri: t.dataset.uri, device: dev ? dev.id : undefined });
          }
          if (e.target.closest('[data-clear]')) { var i = el.querySelector('.mu-search input'); i.value = ''; V.q = ''; V.results = null; paintBrowse(); }
        });
        var input = el.querySelector('.mu-search input');
        input.addEventListener('input', function () {
          clearTimeout(searchTimer);
          var q = input.value.trim();
          searchTimer = setTimeout(function () {
            V.q = q;
            if (!q) { V.results = null; paintBrowse(); return; }
            get('/api/music/search?q=' + encodeURIComponent(q)).then(function (j) { if (V.q === q) { V.results = j; paintBrowse(); } })
              .catch(function (e) { App.toast(App.esc(e.message), { tone: 'error', icon: 'music' }); });
          }, 450);
        });
        el.addEventListener('change', function (e) {
          if (!e.target.matches('[data-vol]')) return;
          var v = +e.target.value;
          clearTimeout(V.volTimer);
          V.volTimer = setTimeout(function () { App.musicCmd('volume', { volume: v }); }, 150);
        });
      }
      paint();
      loadLibrary();
    }
  });
  App.on('live', function (keys) {
    if (keys.indexOf('music') < 0 || !V.el) return;
    var was = V.wasConnected;
    V.wasConnected = !!(D.music || {}).connected;
    // Don't yank the volume slider out from under a finger
    if (document.activeElement && document.activeElement.matches && document.activeElement.matches('[data-vol]')) return;
    paintNow();
    if (!was && V.wasConnected) { V.el.querySelector('.mu-search').style.display = ''; loadLibrary(true); }
  });
  App.on('second', function () {
    if (App.current !== 'music' || !V.el) return;
    var bar = V.el.querySelector('.mu-prog i');
    if (bar && D.music && App.musicProgress) bar.style.width = App.musicProgress(D.music) + '%';
  });
})();
