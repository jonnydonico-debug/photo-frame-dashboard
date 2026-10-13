// Today: greeting, weather, BART with walk/drive times, what's playing, a photo, pinned notes.
(function () {
  'use strict';
  var D = window.DATA;
  var STATIONS = [['PLZA', 'El Cerrito Plaza'], ['DELN', 'El Cerrito del Norte']];

  function greeting() {
    var h = new Date().getHours(), me = App.me(), name = me ? App.person(me).name : '';
    var part = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    return part + (name ? ', ' + App.esc(name) : '');
  }
  function weather() {
    var w = App.weatherNow();
    if (w.none) return '<div class="card"><p class="muted">' + App.esc(w.summary) + '</p></div>';
    var wind = D.settings && D.settings.units === 'celsius' ? ' km/h' : ' mph';
    return '<div class="card wx">' +
      '<div class="wx-top"><span class="wx-ico">' + App.icon(w.cond, 44) + '</span><b class="wx-t">' + w.temp + '°</b>' +
      '<div class="wx-l"><b>' + App.esc(w.label) + '</b><small>H ' + w.hi + '° · L ' + w.lo + '°</small></div></div>' +
      '<p class="wx-sum">' + App.esc(w.summary) + '</p>' +
      '<div class="wx-facts">' +
      '<span><small>Feels like</small><b>' + (w.feels != null ? w.feels + '°' : '–') + '</b></span>' +
      '<span><small>Humidity</small><b>' + (w.humidity != null ? w.humidity + '%' : '–') + '</b></span>' +
      '<span><small>Wind</small><b>' + (w.wind != null ? w.wind + '<i>' + wind + '</i>' : '–') + '</b></span>' +
      '<span><small>Rain</small><b>' + w.rain + '%</b></span></div>' +
      '<div class="wx-hours">' + App.hourly(12).map(function (h) {
        return '<span><small>' + h.label + '</small>' + App.icon(h.c, 22) + '<b>' + h.t + '°</b></span>';
      }).join('') + '</div></div>';
  }
  function trip(t, kind) {
    if (!t) return '';
    return '<span class="trip">' + App.icon(kind, 16) + '<b>' + t.min + '</b> min' + (t.delay > 0 ? '<em>+' + t.delay + '</em>' : '') + '</span>';
  }
  function bart() {
    var B = D.bart || {}, C = D.commute || {};
    var body = STATIONS.map(function (st) {
      var s = (B.stations || []).filter(function (x) { return x.code === st[0]; })[0];
      var c = (C.stations || []).filter(function (x) { return x.code === st[0]; })[0];
      var lines = (s && s.lines) || [];
      return '<div class="stn"><div class="stn-h"><b>' + App.esc((s && s.name) || st[1]) + '</b>' + trip(c && c.walk, 'walk') + trip(c && c.drive, 'car') + '</div>' +
        (lines.length ? lines.slice(0, 4).map(function (l) {
          return '<div class="ln" style="--lc:' + App.esc(l.color) + '"><i></i><span>' + App.esc(l.dest) + '</span><span class="ln-m">' +
            l.mins.slice(0, 3).map(function (m) { return '<b>' + (m === 0 ? 'Now' : m) + '</b>'; }).join('') + '<small>min</small></span></div>';
        }).join('') : '<p class="muted">' + (B.error ? 'Times unavailable right now' : D.bart ? 'No trains scheduled' : 'Loading…') + '</p>') + '</div>';
    }).join('');
    return '<div class="card bart"><div class="card-h">' + App.icon('train', 18) + '<span>BART</span>' + (B.updated ? '<small>' + App.fmt.time(new Date(B.updated)) + '</small>' : '') + '</div>' +
      (B.advisory ? '<button class="adv" data-adv>' + App.icon('bell', 16) + '<span>' + App.esc(B.advisory) + '</span></button>' : '') + body + '</div>';
  }
  function music() {
    var M = D.music || {};
    if (!M.connected) return '';
    if (!M.title) return '<button class="card np np--empty" data-go="music">' + App.icon('music', 24) + '<span><b>Nothing playing</b><small>Tap to pick a playlist</small></span></button>';
    return '<div class="card np">' +
      (M.art ? '<img class="np-art" src="' + App.esc(M.art) + '" alt="" data-go="music">' : '<span class="np-art np-art--none" data-go="music">' + App.icon('music', 26) + '</span>') +
      '<div class="np-meta" data-go="music"><small>' + App.icon('speaker', 13) + ' ' + App.esc(M.device ? M.device.name : 'Spotify') + '</small><b>' + App.esc(M.title) + '</b><span>' + App.esc(M.artist) + '</span></div>' +
      '<div class="np-ctl"><button data-m="prev" aria-label="Previous">' + App.icon('prev', 22) + '</button>' +
      '<button class="np-play" data-m="' + (M.playing ? 'pause' : 'play') + '" aria-label="Play or pause">' + App.icon(M.playing ? 'pause' : 'play', 24) + '</button>' +
      '<button data-m="next" aria-label="Next">' + App.icon('next', 22) + '</button></div>' +
      '<div class="np-prog"><i style="width:' + App.musicProgress(M) + '%"></i></div></div>';
  }
  function photo() {
    var ps = (D.photos || []).filter(function (p) { return p.src; });
    if (!ps.length) return '';
    var day = Math.floor(Date.now() / 864e5), p = ps[day % ps.length];
    return '<button class="card ph-day" data-go="photos"><img src="' + App.esc(p.src) + '" alt="" loading="lazy"><span>Photo of the day</span></button>';
  }
  function notes() {
    var ns = (D.notes || []).filter(function (n) { return n.pinned && !n.done; }).slice(0, 3);
    if (!ns.length) return '';
    return '<div class="card"><div class="card-h">' + App.icon('pin', 18) + '<span>Pinned notes</span></div>' + ns.map(function (n) {
      return '<button class="mini-note" data-go="notes" style="' + App.pstyle(n.by) + '"><i></i><span>' + App.esc(n.text) + '</span></button>';
    }).join('') + '</div>';
  }

  App.screen('today', {
    render: function (el) {
      var n = new Date(), title = (D.settings && D.settings.title) || 'Home';
      el.innerHTML = '<div class="today">' +
        '<header class="hd hd--today"><div><p class="hd-kicker">' + App.esc(title) + '</p><h1>' + greeting() + '</h1><p>' + App.fmt.day(n) + ', ' + App.fmt.month(n) + ' ' + n.getDate() + '</p></div></header>' +
        weather() + '<div class="slot-bart">' + bart() + '</div><div class="slot-music">' + music() + '</div>' + notes() + photo() + '</div>';
      if (!el.dataset.wired) {
        el.dataset.wired = '1';
        el.addEventListener('click', function (e) {
          var t;
          if ((t = e.target.closest('[data-m]'))) return App.musicCmd(t.dataset.m);
          if (e.target.closest('[data-adv]')) return App.sheet('<div class="sh-pad"><h2 class="sh-h">BART advisory</h2><p class="sh-p">' + App.esc((D.bart || {}).advisory || '') + '</p><div class="sh-actions"><button class="btn btn--solid" data-close>OK</button></div></div>');
          if ((t = e.target.closest('[data-go]'))) return App.go(t.dataset.go);
        });
      }
    },
    live: function (keys) {
      var el = App.$('.scr[data-scr="today"]'); if (!el) return;
      if (keys.indexOf('bart') > -1 || keys.indexOf('commute') > -1) { var b = el.querySelector('.slot-bart'); if (b) b.innerHTML = bart(); }
      if (keys.indexOf('music') > -1) { var m = el.querySelector('.slot-music'); if (m) m.innerHTML = music(); }
      if (keys.indexOf('weather') > -1) App.rerender();
    }
  });
  App.on('second', function () {
    if (App.current !== 'today') return;
    var bar = App.$('.scr[data-scr="today"] .np-prog i'); if (bar) bar.style.width = App.musicProgress(D.music) + '%';
  });
  App.on('minute', function () { if (App.current === 'today' && !document.querySelector('#sheetLayer.is-open')) App.rerender(); });
})();
