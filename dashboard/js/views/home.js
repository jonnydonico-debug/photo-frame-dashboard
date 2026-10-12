// Home / Today: time, weather, photos, music and BART. Never scrolls.
(function () {
  'use strict';
  var D = window.DATA, V = {};

  // Progress ring (used by the Chores view)
  App.ring = function (done, total, size) {
    var r = size / 2 - 5, c = 2 * Math.PI * r, f = total ? done / total : 0;
    return '<svg class="ring" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" class="ring-bg"/>' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" class="ring-fg" stroke-dasharray="' + (c * f) + ' ' + c + '" transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')"/></svg>';
  };

  // ------------------------------------------------------------ clock + weather
  function clock() {
    var n = App.now();
    return '<div class="h-time num">' + App.fmt.time(n, false) + '<span class="h-ampm">' + App.fmt.ampm(n) + '</span></div>' +
      '<div class="h-date"><b>' + App.fmt.day(n) + '</b> ' + App.fmt.month(n) + ' ' + n.getDate() + '</div>';
  }

  function weather() {
    var w = App.weatherNow(), W = D.weather || {};
    if (w.none) {
      return '<div class="hm-wx-empty"><span class="hm-wx-icon">' + App.icon('cloud', 54) + '</span>' +
        '<div><b>Weather</b><span>Add your home address in Admin → Settings to see the forecast.</span></div></div>';
    }
    var hours = App.hourly(8);
    var tmin = Math.min.apply(null, hours.map(function (h) { return h.t; }));
    var tmax = Math.max.apply(null, hours.map(function (h) { return h.t; }));
    var wind = D.settings && D.settings.units === 'celsius' ? ' km/h' : ' mph';
    return '<div class="hm-wx-top">' +
      '<span class="hm-wx-icon">' + App.icon(w.cond, 64) + '</span>' +
      '<span class="hm-wx-temp num">' + w.temp + '°</span>' +
      '<div class="hm-wx-meta"><b>' + w.label + '</b>' +
      '<span>H ' + w.hi + '° · L ' + w.lo + '°</span></div>' +
      '<div class="hm-wx-facts">' +
      '<div><small>Feels like</small><b class="num">' + (W.feels != null ? W.feels + '°' : '–') + '</b></div>' +
      '<div><small>Humidity</small><b class="num">' + (W.humidity != null ? W.humidity + '%' : '–') + '</b></div>' +
      '<div><small>Wind</small><b class="num">' + (W.wind != null ? W.wind + '<i>' + wind + '</i>' : '–') + '</b></div>' +
      '<div><small>Rain</small><b class="num">' + (W.p ? W.p[w.hour] + '%' : '–') + '</b></div>' +
      '</div></div>' +
      '<div class="hm-wx-say"><b>' + w.summary + '.</b> ' + w.advice + '.</div>' +
      '<div class="hm-wx-hours">' + hours.map(function (h) {
        var lift = tmax === tmin ? 0 : Math.round((h.t - tmin) / (tmax - tmin) * 5);
        return '<div class="h-hr' + (h.p >= 50 ? ' is-wet' : '') + '"><span class="h-hr-l">' + h.label + '</span>' +
          '<span class="h-hr-i" style="transform:translateY(' + -lift + 'px)">' + App.icon(h.c, 22) + '</span><b>' + h.t + '°</b></div>';
      }).join('') + '</div>';
  }

  // ------------------------------------------------------------ BART
  function trip(c, kind) {
    var t = c && c[kind];
    return t ? '<span class="hm-trip">' + App.icon(kind === 'walk' ? 'walk' : 'car', 18) + '<b class="num">' + t.min + '</b> min<small>' + t.mi + ' mi</small></span>' : '';
  }
  function station(code) {
    var B = D.bart || {}, C = D.commute || {};
    var s = (B.stations || []).filter(function (x) { return x.code === code; })[0];
    var c = (C.stations || []).filter(function (x) { return x.code === code; })[0];
    var name = (s && s.name) || (c && c.name) || code;
    var walk = c && c.walk ? c.walk.min : null;
    var lines = (s && s.lines) || [];
    var rows = lines.slice(0, 3).map(function (l) {
      return '<div class="hm-line" style="--lc:' + App.esc(l.color) + '"><i></i><span class="hm-dest">' + App.esc(l.dest) + '</span>' +
        '<span class="hm-mins">' + l.mins.slice(0, 3).map(function (m) {
          var miss = walk != null && m < walk;
          return '<b class="num' + (miss ? ' is-miss' : '') + '">' + (m === 0 ? 'Now' : m) + '</b>';
        }).join('') + '<small>min</small></span></div>';
    }).join('');
    // The next train you can still walk to
    var leave = '';
    if (walk != null) {
      var best = null;
      lines.forEach(function (l) { l.mins.forEach(function (m) { if (m >= walk && (!best || m < best.m)) best = { m: m, dest: l.dest }; }); });
      if (best) leave = '<span class="hm-leave">' + (best.m - walk <= 0 ? 'Leave now' : 'Leave in ' + (best.m - walk) + ' min') + ' · ' + App.esc(best.dest) + '</span>';
    }
    return '<div class="hm-stn">' +
      '<div class="hm-stn-h"><b>' + App.esc(name) + '</b>' + trip(c, 'walk') + trip(c, 'drive') + '</div>' +
      (leave ? '<div class="hm-stn-sub">' + leave + '</div>' : '') +
      (rows || '<div class="hm-none">' + (B.error ? 'Times unavailable right now' : (D.bart ? 'No trains scheduled' : 'Loading times…')) + '</div>') +
      '</div>';
  }
  function bart() {
    var B = D.bart || {};
    var walkKnown = D.commute && D.commute.stations && D.commute.stations.some(function (s) { return s.walk; });
    return '<div class="hm-card-h"><span class="label">' + App.icon('train', 18) + ' BART</span>' +
      '<span class="hm-upd">' + (walkKnown ? '<i class="hm-key"></i>too soon to walk · ' : '') + (B.updated ? App.fmt.time(new Date(B.updated)) : '') + '</span></div>' +
      (B.advisory ? '<button class="hm-adv" data-adv>' + App.icon('bell', 18) + '<span>' + App.esc(B.advisory) + '</span></button>' : '') +
      station('PLZA') + station('DELN') +
      (!D.commute ? '<div class="hm-hint">Add your address in Admin → Settings for walking and driving times.</div>' : '');
  }

  // ------------------------------------------------------------ music
  function music() {
    var M = D.music || {};
    if (!M.connected) {
      return '<div class="hm-music-empty">' + App.icon('music', 34) + '<div><b>Music</b><span>Connect Spotify in Admin → Music to play on your speakers.</span></div></div>';
    }
    if (!M.title) {
      return '<div class="hm-music-empty">' + App.icon('music', 34) + '<div><b>Nothing playing</b><span>Tap to pick a playlist' + (M.devices && M.devices.length ? ' · ' + M.devices.length + ' speakers ready' : '') + '</span></div></div>';
    }
    return (M.art ? '<img class="hm-art" src="' + App.esc(M.art) + '" alt="">' : '<span class="hm-art hm-art--none">' + App.icon('music', 40) + '</span>') +
      '<div class="hm-np"><span class="label">' + App.icon('speaker', 16) + ' ' + App.esc(M.device ? M.device.name : 'Spotify') + '</span>' +
      '<b>' + App.esc(M.title) + '</b><span>' + App.esc(M.artist) + '</span>' +
      '<div class="hm-prog"><i style="width:' + progress(M) + '%"></i></div></div>' +
      '<div class="hm-ctl">' +
      '<button data-mcmd="prev" aria-label="Previous">' + App.icon('prev', 26) + '</button>' +
      '<button class="hm-play" data-mcmd="' + (M.playing ? 'pause' : 'play') + '" aria-label="Play or pause">' + App.icon(M.playing ? 'pause' : 'play', 32) + '</button>' +
      '<button data-mcmd="next" aria-label="Next">' + App.icon('next', 26) + '</button></div>';
  }
  function progress(M) {
    if (!M.duration) return 0;
    var p = M.progress + (M.playing ? Date.now() - (M.at || Date.now()) : 0);
    return Math.max(0, Math.min(100, p / M.duration * 100));
  }
  App.musicProgress = progress;

  // ------------------------------------------------------------ photos
  function photoCaption(s) {
    var m = App.photoMeta(s.photos[0]);
    V.el.querySelector('.h-photo-cap').innerHTML = '<b>' + (m.onThisDay ? 'On this day · ' : '') + m.kicker + '</b><span>' + App.esc(m.place || '') + '</span>';
  }
  function photoEmpty() {
    var none = !(D.photos && D.photos.length);
    V.el.querySelector('.h-photo').classList.toggle('is-empty', none);
    if (none) V.el.querySelector('.h-photo-cap').innerHTML = '<b>Photos</b><span>Link your shared iCloud album in Admin → Photos</span>';
  }

  function paint() {
    var el = V.el;
    el.querySelector('.h-clock').innerHTML = clock();
    el.querySelector('.hm-weather').innerHTML = weather();
    el.querySelector('.hm-bart').innerHTML = bart();
    el.querySelector('.hm-music').innerHTML = music();
    photoEmpty();
  }

  App.register('home', {
    show: function (el) {
      V.el = el;
      if (!el.firstChild) {
        el.innerHTML = '<div class="hm">' +
          '<div class="h-clock"></div>' +
          '<div class="hm-weather"></div>' +
          '<button class="h-photo" data-go="photos"><div class="h-photo-stage"></div><div class="h-photo-cap"></div></button>' +
          '<div class="hm-side">' +
          '  <div class="hm-bart card"></div>' +
          '  <div class="hm-music card" data-go="music"></div>' +
          '</div></div>';
        el.addEventListener('click', function (e) {
          if (e.target.closest('[data-adv]')) {
            e.stopPropagation();
            App.sheet('<div class="sheet-pad"><div class="label">BART service advisory</div><p class="hm-adv-full">' + App.esc((D.bart || {}).advisory || '') + '</p></div>');
            return;
          }
          var c = e.target.closest('[data-mcmd]');
          if (c) { e.stopPropagation(); App.musicCmd(c.dataset.mcmd); return; }
          var g = e.target.closest('[data-go]');
          if (g) App.go(g.dataset.go);
        });
        V.slides = new App.Slideshow(el.querySelector('.h-photo-stage'), { layout: 'cover', captions: false, interval: 12000, onChange: photoCaption });
      }
      paint();
      V.slides.start();
    },
    resume: function () { V.slides.start(); },
    hide: function () { if (V.slides) V.slides.stop(); }
  });
  App.on('minute', function (n) {
    if (!V.el || !V.el.firstChild) return;
    V.el.querySelector('.h-clock').innerHTML = clock();
    if (n.getMinutes() === 0) V.el.querySelector('.hm-weather').innerHTML = weather();
  });
  // Music progress bar ticks between server updates.
  App.on('second', function () {
    if (App.current !== 'home' || !V.el) return;
    var bar = V.el.querySelector('.hm-prog i');
    if (bar && D.music) bar.style.width = progress(D.music) + '%';
  });
  App.on('data', function () { if (App.current === 'home' && V.el && V.el.firstChild) paint(); });
  App.on('live', function (keys) {
    if (!V.el || !V.el.firstChild) return;
    if (keys.indexOf('bart') > -1 || keys.indexOf('commute') > -1) V.el.querySelector('.hm-bart').innerHTML = bart();
    if (keys.indexOf('music') > -1) V.el.querySelector('.hm-music').innerHTML = music();
    if (keys.indexOf('weather') > -1) V.el.querySelector('.hm-weather').innerHTML = weather();
  });
})();
