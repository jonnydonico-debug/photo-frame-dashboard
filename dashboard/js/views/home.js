// Home / Today: a grid of tiles — clock over photos, BART, weather, music, next up, rain, to-dos.
// Never scrolls.
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

  // "Good morning." etc. Shared with the phone app's wording.
  App.greeting = function (n) {
    var h = n.getHours();
    return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 22 ? 'Good evening' : 'Good night';
  };

  // ------------------------------------------------------------ clock
  function clock() {
    var n = App.now(), title = (D.settings && D.settings.title) || '';
    return '<div class="hm-hero-top"><span class="tag">' + App.icon('calendar', 15) + App.fmt.day(n) + ' · ' + n.getDate() + ' ' + App.fmt.month(n) + '</span>' +
      '<span class="hm-cap">' + (V.cap || '') + '</span></div>' +
      '<div class="h-time">' + App.fmt.time(n, false) + '<span class="h-ampm">' + App.fmt.ampm(n) + '</span></div>' +
      '<div class="hm-greet"><b>' + App.greeting(n) + '.</b>Here’s your day.</div>' +
      (title ? '<div class="hm-house">' + App.esc(title) + '</div>' : '');
  }

  // ------------------------------------------------------------ 3D printer indicator
  // Shows while something is printing (or paused), and for 2 hours after a print ends.
  function printChip() {
    var P = D.printers || [], now = Date.now();
    var p = P.filter(function (x) { return x.online && x.active; })[0] ||
      P.filter(function (x) { return x.online && /^(FINISH|FAILED)$/.test(x.state) && x.endedAt && now - x.endedAt < 2 * 3600e3; })[0];
    if (!p) return '';
    var tone = App.printTone ? App.printTone(p) : 'run', t = App.printTime || function (m) { return m + 'm'; };
    var txt = p.state === 'FINISH' ? 'Print done' : p.state === 'FAILED' ? 'Print failed' : p.paused ? 'Print paused · ' + p.percent + '%'
      : (p.stage && p.state !== 'RUNNING' ? p.stage : 'Printing ' + p.percent + '%' + (p.mins ? ' · ' + t(p.mins) + ' left' : ''));
    return '<span class="hm-print hm-print--' + tone + '" data-print>' + App.icon('printer3d', 16) + '<span>' + App.esc(txt) + '</span>' +
      (p.active ? '<i class="hm-print-bar"><i style="width:' + p.percent + '%"></i></i>' : '') + '</span>';
  }
  function paintChip() { if (V.el && V.el.firstChild) V.el.querySelector('.hm-print-slot').innerHTML = printChip(); }

  // ------------------------------------------------------------ weather
  function weather() {
    var w = App.weatherNow(), W = D.weather || {};
    if (w.none) {
      return '<div class="hm-wx-empty">' + App.icon('cloud', 40) + '<b>Weather</b><span>Add your home address in Admin → Settings to see the forecast.</span></div>';
    }
    var place = W.place || (D.settings && D.settings.place) || 'Weather';
    var hours = App.hourly(12).filter(function (h, i) { return i % 2 === 0; });
    var tmin = Math.min.apply(null, hours.map(function (h) { return h.t; }));
    var tmax = Math.max.apply(null, hours.map(function (h) { return h.t; }));
    return '<div class="hm-wx-place">' + App.esc(place) + '</div>' +
      '<div class="hm-wx-temp">' + w.temp + '°</div>' +
      '<div class="hm-wx-cond">' + w.label + '</div>' +
      '<div class="hm-wx-hi">high of ' + w.hi + '° · low ' + w.lo + '°</div>' +
      '<div class="hm-wx-say">' + w.summary + '. ' + w.advice + '.</div>' +
      '<div class="hm-bars">' + hours.map(function (h) {
        var f = tmax === tmin ? .6 : .22 + (h.t - tmin) / (tmax - tmin) * .78;
        return '<div class="hm-bar' + (h.p >= 50 ? ' is-wet' : '') + '"><small>' + h.t + '°</small><i style="height:' + Math.round(f * 100) + '%"></i><span>' + h.label + '</span></div>';
      }).join('') + '</div>';
  }

  // Chance of rain over the next 12 hours, on a dry → wet scale
  function rain() {
    var W = D.weather || {};
    if (!App.hasWeather()) return '<span class="tag">' + App.icon('drop', 15) + 'Rain</span><div class="hm-rain-v">–</div>';
    var hours = App.hourly(12), max = Math.max.apply(null, hours.map(function (h) { return h.p; }));
    var word = max < 15 ? 'Dry' : max < 35 ? 'Slight chance' : max < 60 ? 'Possible' : max < 80 ? 'Likely' : 'Rainy';
    var wind = D.settings && D.settings.units === 'celsius' ? ' km/h' : ' mph';
    var facts = [];
    if (W.feels != null) facts.push('Feels ' + W.feels + '°');
    if (W.humidity != null) facts.push('Humidity ' + W.humidity + '%');
    if (W.wind != null) facts.push('Wind ' + W.wind + wind);
    return '<span class="tag">' + App.icon('drop', 15) + 'rain · next 12 hours</span>' +
      '<div class="hm-rain-v">' + max + '%<span>' + word + '</span></div>' +
      '<div class="hm-rain-f">' + facts.join(' · ') + '</div>' +
      '<div class="hm-scale"><i></i><i></i><i></i><i></i><i></i><em style="left:' + Math.max(2, Math.min(98, max)) + '%"></em></div>';
  }

  // ------------------------------------------------------------ BART
  function trip(c, kind) {
    var t = c && c[kind];
    return t ? '<span class="hm-trip">' + App.icon(kind === 'walk' ? 'walk' : 'car', 16) + '<b>' + t.min + '</b> min' +
      (t.delay > 0 ? '<small class="hm-delay">+' + t.delay + ' traffic</small>' : '') + '</span>' : '';
  }
  function station(code) {
    var B = D.bart || {}, C = D.commute || {};
    var s = (B.stations || []).filter(function (x) { return x.code === code; })[0];
    var c = (C.stations || []).filter(function (x) { return x.code === code; })[0];
    var name = (s && s.name) || (c && c.name) || { PLZA: 'El Cerrito Plaza', DELN: 'El Cerrito del Norte' }[code] || code;
    var lines = (s && s.lines) || [];
    // Room for 3 trains a station, or 2 while a service alert is showing
    var rows = lines.slice(0, B.advisory ? 2 : 3).map(function (l) {
      return '<div class="hm-line" style="--lc:' + App.esc(l.color) + '"><i></i><span class="hm-dest">' + App.esc(l.dest) + '</span>' +
        '<span class="hm-mins">' + l.mins.slice(0, 3).map(function (m) {
          return '<b>' + (m === 0 ? 'Now' : m) + '</b>';
        }).join('') + '<small>min</small></span></div>';
    }).join('');
    return '<div class="hm-stn">' +
      '<div class="hm-stn-h"><b>' + App.esc(name) + '</b>' + trip(c, 'walk') + trip(c, 'drive') + '</div>' +
      (rows || '<div class="hm-none">' + (B.error ? 'Times unavailable right now' : (D.bart ? 'No trains scheduled' : 'Loading times…')) + '</div>') +
      '</div>';
  }
  function bart() {
    var B = D.bart || {};
    return '<div class="hm-card-h"><h2 class="hm-h">BART, <i>next trains</i></h2>' +
      '<span class="hm-upd">' + (B.updated ? App.fmt.time(new Date(B.updated)) : '') + '</span></div>' +
      (B.advisory ? '<button class="hm-adv" data-adv>' + App.icon('bell', 18) + '<span>' + App.esc(B.advisory) + '</span></button>' : '') +
      station('PLZA') + station('DELN') +
      (!D.commute ? '<div class="hm-hint">Add your address in Admin → Settings for walking and driving times.</div>' : '');
  }

  // ------------------------------------------------------------ music
  function mmss(ms) { var s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2); }
  function music() {
    var M = D.music || {};
    if (!M.connected) {
      return '<div class="hm-music-empty"><span class="hm-art">' + App.icon('music', 40) + '</span><div><b>Music</b><span>Connect Spotify in Admin → Music to play on your speakers.</span></div></div>';
    }
    if (!M.title) {
      return '<div class="hm-music-empty"><span class="hm-art">' + App.icon('music', 40) + '</span><div><b>Nothing playing</b><span>Tap to pick a playlist' + (M.devices && M.devices.length ? ' · ' + M.devices.length + ' speakers ready' : '') + '</span></div></div>';
    }
    return (M.art ? '<img class="hm-art" src="' + App.esc(M.art) + '" alt="">' : '<span class="hm-art hm-art--none">' + App.icon('music', 40) + '</span>') +
      '<div class="hm-np"><span class="tag">' + App.icon('speaker', 15) + (M.playing ? 'Now playing' : 'Last played') + (M.device ? ' · ' + App.esc(M.device.name) : '') + '</span>' +
      '<b>' + App.esc(M.title) + '</b><span>' + App.esc(M.artist) + '</span>' +
      '<div class="hm-prog-row"><span class="hm-pos">' + mmss(position(M)) + '</span><div class="hm-prog"><i style="width:' + progress(M) + '%"></i></div><span>' + (M.duration ? mmss(M.duration) : '') + '</span></div>' +
      '<div class="hm-np-foot"><span class="hm-open">Open music ↗</span><div class="hm-ctl">' +
      '<button data-mcmd="prev" aria-label="Previous">' + App.icon('prev', 20) + '</button>' +
      '<button class="hm-play" data-mcmd="' + (M.playing ? 'pause' : 'play') + '" aria-label="Play or pause">' + App.icon(M.playing ? 'pause' : 'play', 22) + '</button>' +
      '<button data-mcmd="next" aria-label="Next">' + App.icon('next', 20) + '</button></div></div></div>';
  }
  function position(M) {
    if (!M.duration) return 0;
    return Math.min(M.duration, M.progress + (M.playing ? Date.now() - (M.at || Date.now()) : 0));
  }
  function progress(M) {
    if (!M.duration) return 0;
    return Math.max(0, Math.min(100, position(M) / M.duration * 100));
  }
  App.musicProgress = progress;

  // ------------------------------------------------------------ next up: the next calendar event, else the shopping list
  function upcoming() {
    var now = App.now(), until = App.addDays(App.dayStart(now), 15);
    return App.events().filter(function (e) { return e.end > now && e.start < until; })
      .sort(function (a, b) { return a.start - b.start; })[0] || null;
  }
  function when(e) {
    var now = App.now();
    if (e.start <= now) return 'Happening now';
    var days = Math.round((App.dayStart(e.start) - App.dayStart(now)) / 864e5);
    if (days === 0) { var m = (e.start - now) / 60000; return m < 60 ? 'in ' + Math.max(1, Math.round(m)) + ' min' : 'in ' + Math.round(m / 60) + ' hr'; }
    return days === 1 ? 'tomorrow' : 'in ' + days + ' days';
  }
  function next() {
    var e = upcoming();
    if (e) {
      var p = App.evColor(e);
      V.nextGo = 'calendar';
      return '<span class="tag">' + App.icon('calendar', 15) + (e.srcName ? App.esc(e.srcName) : 'Up next') + '</span>' +
        '<div class="hm-next-main" style="' + App.pstyle(p) + '"><span class="hm-next-ico">' + App.icon('calendar', 24) + '</span>' +
        '<b>' + App.esc(e.title) + (e.loc ? '<small>' + App.esc(e.loc) + '</small>' : '') + '</b></div>' +
        '<div class="hm-pills"><span class="hm-pill">' + App.fmt.dayShort(e.start) + (e.allDay ? ' · all day' : ' · ' + App.fmt.time(e.start).toLowerCase()) + '</span>' +
        '<span class="hm-pill"><i></i>' + when(e) + '</span></div>';
    }
    var list = (D.groceries || []).filter(function (g) { return !g.done; });
    V.nextGo = 'shopping';
    var stores = {};
    list.forEach(function (g) { var s = g.store || ''; stores[s] = (stores[s] || 0) + 1; });
    var named = (D.stores || []).filter(function (s) { return stores[s.id]; });
    return '<span class="tag">' + App.icon('cart', 15) + 'Shopping list</span>' +
      '<div class="hm-next-main"><span class="hm-next-ico">' + App.icon('cart', 24) + '</span>' +
      '<b>' + (list.length ? list.length + (list.length === 1 ? ' thing' : ' things') + ' to get' : 'All stocked up') +
      '<small>' + (list.length ? App.esc(list.slice(0, 4).map(function (g) { return g.name; }).join(', ')) + (list.length > 4 ? '…' : '') : 'Nothing on the list') + '</small></b></div>' +
      '<div class="hm-pills">' + (named.length ? named.slice(0, 3).map(function (s) { return '<span class="hm-pill"><i></i>' + App.esc(s.name) + ' · ' + stores[s.id] + '</span>'; }).join('') :
        '<span class="hm-pill">Calendar is clear</span>') + '</div>';
  }

  // ------------------------------------------------------------ to-dos: today's chores and open reminders
  function todos() {
    var t0 = +App.dayStart(App.now());
    var chores = (D.chores || []).map(function (c) { return { kind: 'chore', id: c.id, text: c.title, done: !!c.done }; });
    var rems = (D.todos || []).filter(function (t) { return !t.done || (t.doneAt || 0) >= t0; })
      .map(function (t) { return { kind: 'todo', id: t.id, text: t.text, done: !!t.done }; });
    var all = chores.concat(rems).sort(function (a, b) { return (b.done ? 1 : 0) - (a.done ? 1 : 0); });
    var left = all.filter(function (x) { return !x.done; }).length;
    return '<div class="hm-todo-h"><b>' + (rems.length ? 'To do,' : 'Chores,') + '</b>' + (left ? left + ' left today' : 'all done') + '</div>' +
      '<div class="hm-todo-list">' + (all.length ? all.map(function (x) {
        return '<button class="' + (x.done ? 'is-done' : '') + '" data-' + x.kind + '="' + App.esc(x.id) + '"><i>' + (x.done ? App.icon('check', 13) : '') + '</i><span>' + App.esc(x.text) + '</span></button>';
      }).join('') : '<span class="hm-todo-none">Nothing to do today. Add reminders from the Reminders tab or by texting Dommy.</span>') + '</div>';
  }
  function tickTodo(id) {
    D.todos = (D.todos || []).map(function (x) { return x.id === id ? Object.assign({}, x, { done: !x.done, doneAt: x.done ? null : Date.now() }) : x; });
    App.emit('data');
  }

  // ------------------------------------------------------------ photos
  function photoCaption(s) {
    var m = App.photoMeta(s.photos[0]);
    V.cap = App.esc((m.onThisDay ? 'On this day · ' : '') + m.kicker + (m.place ? ' · ' + m.place : ''));
    var c = V.el.querySelector('.hm-cap');
    if (c) c.innerHTML = V.cap;
  }

  function paint() {
    var el = V.el;
    if (!(D.photos && D.photos.length)) V.cap = '';
    el.querySelector('.h-clock').innerHTML = clock();
    el.querySelector('.hm-weather').innerHTML = weather();
    el.querySelector('.hm-rain').innerHTML = rain();
    el.querySelector('.hm-bart').innerHTML = bart();
    el.querySelector('.hm-music').innerHTML = music();
    el.querySelector('.hm-next').innerHTML = next();
    el.querySelector('.hm-todo').innerHTML = todos();
    paintChip();
  }

  App.register('home', {
    show: function (el) {
      V.el = el;
      if (!el.firstChild) {
        el.innerHTML = '<div class="hm">' +
          '<button class="hm-tile hm-hero" data-go="photos"><div class="h-photo-stage"></div><div class="h-clock"></div><span class="hm-print-slot"></span></button>' +
          '<div class="hm-tile hm-bart"></div>' +
          '<div class="hm-tile hm-weather"></div>' +
          '<div class="hm-tile hm-music" data-go="music"></div>' +
          '<button class="hm-tile hm-next" data-next></button>' +
          '<div class="hm-tile hm-rain"></div>' +
          '<div class="hm-tile hm-todo"></div>' +
          '</div>';
        el.addEventListener('click', function (e) {
          if (e.target.closest('[data-adv]')) {
            e.stopPropagation();
            App.sheet('<div class="sheet-pad"><div class="label">BART service advisory</div><p class="hm-adv-full">' + App.esc((D.bart || {}).advisory || '') + '</p></div>');
            return;
          }
          if (e.target.closest('[data-print]')) { e.stopPropagation(); App.go('control'); return; }
          var c = e.target.closest('[data-mcmd]');
          if (c) { e.stopPropagation(); App.musicCmd(c.dataset.mcmd); return; }
          var t = e.target.closest('[data-todo]');
          if (t) { tickTodo(t.dataset.todo); return; }
          if (e.target.closest('[data-chore]')) { App.go('tasks'); return; }
          if (e.target.closest('[data-next]')) { App.go(V.nextGo || 'shopping'); return; }
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
    V.el.querySelector('.hm-next').innerHTML = next();
    paintChip();
    if (n.getMinutes() === 0) { V.el.querySelector('.hm-weather').innerHTML = weather(); V.el.querySelector('.hm-rain').innerHTML = rain(); }
    if (n.getHours() === 0 && n.getMinutes() === 0) V.el.querySelector('.hm-todo').innerHTML = todos();
  });
  // Music progress bar ticks between server updates.
  App.on('second', function () {
    if (App.current !== 'home' || !V.el || !D.music) return;
    var bar = V.el.querySelector('.hm-prog i'), pos = V.el.querySelector('.hm-pos');
    if (bar) bar.style.width = progress(D.music) + '%';
    if (pos) pos.textContent = mmss(position(D.music));
  });
  App.on('data', function () { if (App.current === 'home' && V.el && V.el.firstChild) paint(); });
  App.on('live', function (keys) {
    if (!V.el || !V.el.firstChild) return;
    if (keys.indexOf('bart') > -1 || keys.indexOf('commute') > -1) V.el.querySelector('.hm-bart').innerHTML = bart();
    if (keys.indexOf('music') > -1) V.el.querySelector('.hm-music').innerHTML = music();
    if (keys.indexOf('weather') > -1) { V.el.querySelector('.hm-weather').innerHTML = weather(); V.el.querySelector('.hm-rain').innerHTML = rain(); }
    if (keys.indexOf('events') > -1 || keys.indexOf('groceries') > -1) V.el.querySelector('.hm-next').innerHTML = next();
    if (keys.indexOf('todos') > -1 || keys.indexOf('chores') > -1) V.el.querySelector('.hm-todo').innerHTML = todos();
    if (keys.indexOf('printers') > -1) paintChip();
  });
})();
