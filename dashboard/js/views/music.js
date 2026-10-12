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
    return '<button class="mu-tile" data-open="' + App.esc(x.uri) + '">' +
      (x.art ? '<img src="' + App.esc(x.art) + '" alt="" loading="lazy">' : '<span class="mu-tile-ph' + (x.liked ? ' mu-tile-ph--liked' : '') + '">' + App.icon(x.liked ? 'heart' : 'music', 30) + '</span>') +
      '<b>' + App.esc(x.name) + '</b><small>' + App.esc(x.by || '') + '</small></button>';
  }
  function row(x) {
    return '<button class="mu-row" data-uri="' + App.esc(x.uri) + '">' + (x.art ? '<img src="' + App.esc(x.art) + '" alt="">' : '<span></span>') +
      '<span><b>' + App.esc(x.name) + '</b><small>' + App.esc(x.by || '') + '</small></span>' + App.icon('play', 22) + '</button>';
  }
  function fmtMs(ms) { var s = Math.round((ms || 0) / 1000); return Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2); }
  function detail() {
    var X = V.detail;
    if (X.loading) return '<button class="mu-back" data-back>' + App.icon('left', 22) + ' Back</button><p class="mu-note">Opening…</p>';
    if (X.error) return '<button class="mu-back" data-back>' + App.icon('left', 22) + ' Back</button><p class="mu-note">' + App.esc(X.error) + '</p>';
    var nowUri = (D.music || {}).uri;
    return '<button class="mu-back" data-back>' + App.icon('left', 22) + ' Back</button>' +
      '<div class="mu-hero">' + (X.art ? '<img src="' + App.esc(X.art) + '" alt="">' : '<span class="mu-tile-ph mu-tile-ph--liked">' + App.icon(X.kind === 'liked' ? 'heart' : 'music', 40) + '</span>') +
      '<div><span class="label">' + App.esc({ playlist: 'Playlist', album: 'Album', artist: 'Artist', liked: 'Your library' }[X.kind] || '') + '</span>' +
      '<h2 class="serif">' + App.esc(X.name) + '</h2><small>' + App.esc(X.by || '') + '</small>' +
      (X.tracks.length || X.playAs === 'context' ? '<button class="mu-playall" data-ti="0">' + App.icon('play', 22) + ' Play' + (X.kind === 'artist' ? ' top songs' : '') + '</button>' : '') + '</div></div>' +
      (X.tracks.length ? '<div class="mu-tracks">' + X.tracks.map(function (t, i) {
        return '<button class="mu-track' + (t.uri === nowUri ? ' is-now' : '') + '" data-ti="' + i + '"><span class="num">' + (i + 1) + '</span>' +
          '<span><b>' + App.esc(t.name) + '</b><small>' + App.esc(t.by) + '</small></span><em class="num">' + fmtMs(t.ms) + '</em></button>';
      }).join('') + '</div>' : '<p class="mu-note">' + (X.kind === 'playlist' ? 'Spotify only shows the song list for playlists you made. Press Play to play this one.' : 'No songs here.') + '</p>') +
      (X.albums && X.albums.length ? '<div class="label">Albums</div><div class="mu-tiles">' + X.albums.map(tile).join('') + '</div>' : '');
  }
  function openItem(uri) {
    V.stack = V.stack || [];
    if (V.detail && !V.detail.loading) V.stack.push(V.detail);
    V.detail = { loading: true, uri: uri };
    paintBrowse();
    V.el.querySelector('.mu-browse').scrollTop = 0;
    get('/api/music/items?uri=' + encodeURIComponent(uri)).then(function (j) { if (V.detail && V.detail.uri === uri) { V.detail = j; V.detail.uri = uri; paintBrowse(); } })
      .catch(function (e) { if (V.detail && V.detail.uri === uri) { V.detail = { error: e.message, uri: uri }; paintBrowse(); } });
  }
  function hasSpeaker() { var M = D.music || {}; return !!(M.device || M.target); }
  function playFrom(i) {
    var X = V.detail;
    if (!hasSpeaker()) return openSpeakers();
    var t = X.tracks[i];
    if (!X.tracks.length) { App.toast('Playing <b>' + App.esc(X.name) + '</b>', { icon: 'music', ms: 2200 }); return App.musicCmd('play', { uri: X.uri }); }
    App.toast('Playing <b>' + App.esc(t ? t.name : X.name) + '</b>', { icon: 'music', ms: 2200 });
    if (X.playAs === 'context') App.musicCmd('play', { uri: X.uri, offset: i });
    else App.musicCmd('play', { uris: X.tracks.map(function (x) { return x.uri; }), offset: i });
  }
  function browse() {
    var M = D.music || {};
    if (!M.connected) return '';
    if (V.detail) return detail();
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
    App.sheet('<div class="sheet-pad"><div class="label">Speakers</div><h2 class="serif sheet-h">Play on…</h2>' +
      (list.length ? '<div class="mu-devs">' + list.map(function (d) {
        return '<button class="mu-devrow' + (d.active ? ' is-on' : '') + '" data-dev="' + App.esc(d.id) + '"' + (d.restricted ? ' disabled' : '') + '>' +
          App.icon('speaker', 28) + '<span><b>' + App.esc(d.name) + '</b><small>' + App.esc(d.sonos ? 'Sonos' : d.type) + (d.active ? ' · selected' : '') + '</small></span></button>';
      }).join('') + '</div>' :
        '<p class="sheet-p">No speakers found. Open Spotify on a phone or computer, or check the Sonos is on.</p>') +
      '<p class="mu-note">Sonos speakers on your Wi-Fi always show here. Phones and computers show up while Spotify is open on them.</p></div>', {
      cls: 'sheet--wide',
      onMount: function (s, close) {
        s.addEventListener('click', function (e) {
          var b = e.target.closest('[data-dev]');
          if (!b) return;
          close();
          App.toast('Moving music to <b>' + App.esc(b.querySelector('b').textContent) + '</b>', { icon: 'speaker', ms: 2500 });
          App.musicCmd('transfer', { device: b.dataset.dev, name: b.querySelector('b').textContent });
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
          if ((t = e.target.closest('[data-open]'))) return openItem(t.dataset.open);
          if (e.target.closest('[data-back]')) { V.detail = (V.stack || []).pop() || null; return paintBrowse(); }
          if ((t = e.target.closest('[data-ti]'))) return playFrom(+t.dataset.ti);
          if ((t = e.target.closest('[data-uri]'))) {
            if (!hasSpeaker()) return openSpeakers();
            App.toast('Playing <b>' + App.esc(t.querySelector('b').textContent) + '</b>', { icon: 'music', ms: 2200 });
            return App.musicCmd('play', { uris: [t.dataset.uri] });
          }
          if (e.target.closest('[data-clear]')) { var i = el.querySelector('.mu-search input'); i.value = ''; V.q = ''; V.results = null; V.detail = null; V.stack = []; paintBrowse(); }
        });
        var input = el.querySelector('.mu-search input');
        input.addEventListener('input', function () {
          clearTimeout(searchTimer);
          var q = input.value.trim();
          searchTimer = setTimeout(function () {
            V.q = q;
            V.detail = null; V.stack = [];
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
