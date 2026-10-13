// Music: Spotify + Sonos through the Mac mini, same as the frame. Now playing, speakers, volume,
// your playlists and Liked Songs, albums, artists and search.
(function () {
  'use strict';
  var D = window.DATA;
  var V = { lib: null, libAt: 0, detail: null, stack: [], q: '', results: null, volTimer: null };

  function fmtMs(ms) { var s = Math.round((ms || 0) / 1000); return Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2); }
  function hasSpeaker() { var M = D.music || {}; return !!(M.device || M.target); }

  function now() {
    var M = D.music || {};
    if (!M.connected) return '<div class="empty">' + App.icon('music', 30) + '<b>Spotify isn’t connected</b><span>Connect it once in Admin → Music, then play anything on your speakers from here.</span></div>';
    var dev = M.device;
    return '<div class="card mu-now">' +
      '<div class="mu-top">' + (M.title && M.art ? '<img class="mu-art" src="' + App.esc(M.art) + '" alt="">' : '<span class="mu-art mu-art--none">' + App.icon('music', 34) + '</span>') +
      '<div class="mu-meta"><b>' + App.esc(M.title || 'Nothing playing') + '</b><span>' + App.esc(M.title ? M.artist : 'Pick something below') + '</span></div></div>' +
      '<div class="mu-prog"><i style="width:' + App.musicProgress(M) + '%"></i></div>' +
      '<div class="mu-ctl"><button class="mu-sm' + (M.shuffle ? ' is-on' : '') + '" data-mc="shuffle" aria-label="Shuffle">' + App.icon('shuffle', 22) + '</button>' +
      '<button data-mc="prev" aria-label="Previous">' + App.icon('prev', 28) + '</button>' +
      '<button class="mu-play" data-mc="' + (M.playing ? 'pause' : 'play') + '" aria-label="Play or pause">' + App.icon(M.playing ? 'pause' : 'play', 30) + '</button>' +
      '<button data-mc="next" aria-label="Next">' + App.icon('next', 28) + '</button>' +
      '<button class="mu-sm" data-speakers aria-label="Speakers">' + App.icon('speaker', 22) + '</button></div>' +
      '<button class="mu-dev" data-speakers>' + App.icon('speaker', 16) + '<span>' + (dev ? 'Playing on <b>' + App.esc(dev.name) + '</b>' : M.target ? 'Speaker: <b>' + App.esc(M.target.name) + '</b>' : 'Choose a speaker') + '</span>' + App.icon('right', 16) + '</button>' +
      (dev && dev.volume != null ? '<label class="mu-vol">' + App.icon('speaker', 16) + '<input type="range" min="0" max="100" step="2" value="' + dev.volume + '" data-vol aria-label="Volume"></label>' : '') + '</div>';
  }
  function tile(x) {
    return '<button class="mu-tile" data-open="' + App.esc(x.uri) + '">' +
      (x.art ? '<img src="' + App.esc(x.art) + '" alt="" loading="lazy">' : '<span class="mu-ph">' + App.icon(x.liked ? 'heart' : 'music', 26) + '</span>') +
      '<b>' + App.esc(x.name) + '</b><small>' + App.esc(x.by || '') + '</small></button>';
  }
  function row(x) {
    return '<button class="mu-row" data-uri="' + App.esc(x.uri) + '">' + (x.art ? '<img src="' + App.esc(x.art) + '" alt="" loading="lazy">' : '<span class="mu-row-ph"></span>') +
      '<span><b>' + App.esc(x.name) + '</b><small>' + App.esc(x.by || '') + '</small></span>' + App.icon('play', 18) + '</button>';
  }
  function detail() {
    var X = V.detail, back = '<button class="back" data-back>' + App.icon('left', 20) + 'Back</button>';
    if (X.loading) return back + '<p class="muted pad">Opening…</p>';
    if (X.error) return back + '<p class="muted pad">' + App.esc(X.error) + '</p>';
    var nowUri = (D.music || {}).uri;
    return back + '<div class="mu-hero">' + (X.art ? '<img src="' + App.esc(X.art) + '" alt="">' : '<span class="mu-ph">' + App.icon(X.kind === 'liked' ? 'heart' : 'music', 36) + '</span>') +
      '<div><small>' + App.esc({ playlist: 'Playlist', album: 'Album', artist: 'Artist', liked: 'Your library' }[X.kind] || '') + '</small><h2>' + App.esc(X.name) + '</h2><span>' + App.esc(X.by || '') + '</span></div></div>' +
      (X.tracks.length || X.playAs === 'context' ? '<button class="btn btn--solid btn--wide" data-ti="0">' + App.icon('play', 18) + 'Play' + (X.kind === 'artist' ? ' top songs' : '') + '</button>' : '') +
      (X.tracks.length ? '<div class="group mu-tracks">' + X.tracks.map(function (t, i) {
        return '<button class="mu-track' + (t.uri === nowUri ? ' is-now' : '') + '" data-ti="' + i + '"><span class="mu-n">' + (i + 1) + '</span><span><b>' + App.esc(t.name) + '</b><small>' + App.esc(t.by) + '</small></span><em>' + fmtMs(t.ms) + '</em></button>';
      }).join('') + '</div>' : '<p class="muted pad">' + (X.kind === 'playlist' ? 'Spotify only shows the songs in playlists you made. Press Play to play this one.' : 'No songs here.') + '</p>') +
      (X.albums && X.albums.length ? '<div class="sec-l">Albums</div><div class="mu-tiles">' + X.albums.map(tile).join('') + '</div>' : '');
  }
  function browse() {
    var M = D.music || {};
    if (!M.connected) return '';
    if (V.detail) return detail();
    var R = V.results;
    if (R) {
      var all = (R.tracks || []).length + (R.albums || []).length + (R.artists || []).length;
      if (!all) return '<p class="muted pad">No results for “' + App.esc(V.q) + '”.</p>';
      return (R.tracks.length ? '<div class="sec-l">Songs</div><div class="group">' + R.tracks.slice(0, 6).map(row).join('') + '</div>' : '') +
        (R.albums.length || R.artists.length ? '<div class="sec-l">Albums and artists</div><div class="mu-tiles">' + R.albums.slice(0, 6).concat(R.artists.slice(0, 4)).map(tile).join('') + '</div>' : '');
    }
    if (!V.lib) return '<p class="muted pad">Loading your playlists…</p>';
    if (V.lib.error) return '<p class="muted pad">' + App.esc(V.lib.error) + '</p>';
    return (V.lib.recentTracks && V.lib.recentTracks.length ? '<div class="sec-l">Recently played</div><div class="group">' + V.lib.recentTracks.slice(0, 5).map(row).join('') + '</div>' : '') +
      '<div class="sec-l">Your playlists</div><div class="mu-tiles">' + V.lib.playlists.map(tile).join('') + '</div>';
  }
  function el() { return App.$('.scr[data-scr="music"]'); }
  function paintNow() { var e = el(); if (e && e.querySelector('.mu-slot')) e.querySelector('.mu-slot').innerHTML = now(); }
  function paintBrowse() { var e = el(); if (e && e.querySelector('.mu-browse')) e.querySelector('.mu-browse').innerHTML = browse(); }

  function loadLibrary(force) {
    if (!(D.music || {}).connected) return;
    if (!force && V.lib && !V.lib.error && Date.now() - V.libAt < 5 * 60000) return;
    V.libAt = Date.now();
    App.get('/api/music/library').then(function (j) { V.lib = j; paintBrowse(); }).catch(function (e) { V.lib = { error: e.message, playlists: [] }; paintBrowse(); });
  }
  function openItem(uri) {
    if (V.detail && !V.detail.loading) V.stack.push(V.detail);
    V.detail = { loading: true, uri: uri }; paintBrowse(); window.scrollTo(0, 0);
    App.get('/api/music/items?uri=' + encodeURIComponent(uri)).then(function (j) { if (V.detail && V.detail.uri === uri) { V.detail = j; V.detail.uri = uri; paintBrowse(); } })
      .catch(function (e) { if (V.detail && V.detail.uri === uri) { V.detail = { error: e.message, uri: uri }; paintBrowse(); } });
  }
  function playFrom(i) {
    var X = V.detail;
    if (!hasSpeaker()) return speakers();
    var t = X.tracks[i];
    App.toast('Playing <b>' + App.esc(t ? t.name : X.name) + '</b>', { icon: 'music', ms: 2000 });
    if (!X.tracks.length) return App.musicCmd('play', { uri: X.uri });
    if (X.playAs === 'context') App.musicCmd('play', { uri: X.uri, offset: i });
    else App.musicCmd('play', { uris: X.tracks.map(function (x) { return x.uri; }), offset: i });
  }
  function speakers() {
    var list = (D.music || {}).devices || [];
    App.sheet('<div class="sh-pad"><h2 class="sh-h">Play on…</h2>' +
      (list.length ? '<div class="sh-list">' + list.map(function (d) {
        return '<button data-dev="' + App.esc(d.id) + '" data-name="' + App.esc(d.name) + '" class="' + (d.active ? 'is-on' : '') + '"' + (d.restricted ? ' disabled' : '') + '>' + App.icon('speaker', 20) +
          '<span><b>' + App.esc(d.name) + '</b><small>' + App.esc(d.sonos ? 'Sonos' : d.type) + (d.active ? ' · selected' : '') + '</small></span></button>';
      }).join('') + '</div>' : '<p class="sh-p">No speakers found. Open Spotify on a phone or computer, or check the Sonos is on.</p>') +
      '<p class="sh-note">Sonos speakers at home always show here. Phones and computers show up while Spotify is open on them.</p></div>', {
      onMount: function (s, close) {
        s.addEventListener('click', function (e) {
          var b = e.target.closest('[data-dev]'); if (!b) return;
          close();
          App.toast('Moving music to <b>' + App.esc(b.dataset.name) + '</b>', { icon: 'speaker', ms: 2200 });
          App.musicCmd('transfer', { device: b.dataset.dev, name: b.dataset.name });
        });
      }
    });
  }

  var searchTimer = null;
  App.screen('music', {
    render: function (e) {
      var M = D.music || {};
      e.innerHTML = App.head('Music') + '<div class="mu-slot">' + now() + '</div>' +
        (M.connected ? '<div class="search">' + App.icon('search', 18) + '<input type="search" placeholder="Songs, artists, albums" enterkeyhint="search" value="' + App.esc(V.q) + '">' + (V.q ? '<button data-clear aria-label="Clear">' + App.icon('x', 16) + '</button>' : '') + '</div>' : '') +
        '<div class="mu-browse">' + browse() + '</div>';
      var input = e.querySelector('.search input');
      if (input) input.addEventListener('input', function () {
        clearTimeout(searchTimer);
        var q = input.value.trim();
        searchTimer = setTimeout(function () {
          V.q = q; V.detail = null; V.stack = [];
          if (!q) { V.results = null; paintBrowse(); return; }
          App.get('/api/music/search?q=' + encodeURIComponent(q)).then(function (j) { if (V.q === q) { V.results = j; paintBrowse(); } }).catch(function (err) { App.toast(App.esc(err.message), { tone: 'error', icon: 'music' }); });
        }, 400);
      });
      if (!e.dataset.wired) {
        e.dataset.wired = '1';
        e.addEventListener('click', function (ev) {
          var t;
          if ((t = ev.target.closest('[data-mc]'))) { var a = t.dataset.mc; return a === 'shuffle' ? App.musicCmd('shuffle', { on: !(D.music || {}).shuffle }) : App.musicCmd(a); }
          if (ev.target.closest('[data-speakers]')) return speakers();
          if ((t = ev.target.closest('[data-open]'))) return openItem(t.dataset.open);
          if (ev.target.closest('[data-back]')) { V.detail = V.stack.pop() || null; return paintBrowse(); }
          if ((t = ev.target.closest('[data-ti]'))) return playFrom(+t.dataset.ti);
          if ((t = ev.target.closest('[data-uri]'))) {
            if (!hasSpeaker()) return speakers();
            App.toast('Playing <b>' + App.esc(t.querySelector('b').textContent) + '</b>', { icon: 'music', ms: 2000 });
            return App.musicCmd('play', { uris: [t.dataset.uri] });
          }
          if (ev.target.closest('[data-clear]')) { V.q = ''; V.results = null; V.detail = null; V.stack = []; App.rerender(); }
        });
        e.addEventListener('change', function (ev) {
          if (!ev.target.matches('[data-vol]')) return;
          var v = +ev.target.value; clearTimeout(V.volTimer);
          V.volTimer = setTimeout(function () { App.musicCmd('volume', { volume: v }); }, 120);
        });
      }
      loadLibrary();
    },
    reset: function () { V.detail = null; V.stack = []; V.q = ''; V.results = null; },
    live: function (keys) {
      if (keys.indexOf('music') < 0) return;
      var a = document.activeElement;
      if (a && a.matches && (a.matches('[data-vol]') || a.matches('.search input'))) return;
      var wasLib = !!V.lib; paintNow(); if (!wasLib) loadLibrary(true);
    }
  });
  App.openSpeakers = speakers;
  App.on('second', function () {
    if (App.current !== 'music') return;
    var bar = App.$('.scr[data-scr="music"] .mu-prog i'); if (bar) bar.style.width = App.musicProgress(D.music) + '%';
  });
})();
