// Today: the same tiles as the frame's Today screen, stacked for a phone — clock and greeting over
// the photo of the day, weather, next up, to-dos, BART, what's playing and pinned notes.
(function () {
  'use strict';
  var D = window.DATA;
  var STATIONS = [['PLZA', 'El Cerrito Plaza'], ['DELN', 'El Cerrito del Norte']];

  function hero() {
    var n = new Date(), me = App.me(), name = me ? App.person(me).name : '';
    var ps = (D.photos || []).filter(function (p) { return p.src; });
    var p = ps.length ? ps[Math.floor(Date.now() / 864e5) % ps.length] : null;
    var title = (D.settings && D.settings.title) || '';
    return '<button class="tcard hero" data-go="photos">' + (p ? '<img src="' + App.esc(p.src) + '" alt="" loading="lazy">' : '') +
      '<div class="hero-in"><span class="tag">' + App.icon('calendar', 14) + App.fmt.day(n) + ' · ' + n.getDate() + ' ' + App.fmt.month(n) + '</span>' +
      '<div class="hero-time">' + App.fmt.time(n, false) + '<i>' + App.fmt.ampm(n).toLowerCase() + '</i></div>' +
      '<div class="hero-greet"><b>' + App.greeting(n) + (name ? ', ' + App.esc(name) : '') + '.</b>Here’s your day.</div>' +
      (title ? '<small>' + App.esc(title) + '</small>' : '') + '</div></button>';
  }

  function weather() {
    var w = App.weatherNow(), W = D.weather || {};
    if (w.none) return '<div class="tcard"><p class="muted">' + App.esc(w.summary) + '</p></div>';
    var place = W.place || (D.settings && D.settings.place) || 'Weather';
    var hours = App.hourly(12).filter(function (h, i) { return i % 2 === 0; });
    var ts = hours.map(function (h) { return h.t; }), tmin = Math.min.apply(null, ts), tmax = Math.max.apply(null, ts);
    var all = App.hourly(12), rain = Math.max.apply(null, all.map(function (h) { return h.p; }).concat([0]));
    var word = rain < 15 ? 'Dry' : rain < 35 ? 'Slight chance' : rain < 60 ? 'Possible' : rain < 80 ? 'Likely' : 'Rainy';
    var wind = D.settings && D.settings.units === 'celsius' ? ' km/h' : ' mph';
    var facts = [];
    if (w.feels != null) facts.push('Feels ' + w.feels + '°');
    if (w.humidity != null) facts.push('Humidity ' + w.humidity + '%');
    if (w.wind != null) facts.push('Wind ' + w.wind + wind);
    return '<div class="tcard wx2"><div class="wx2-top"><div><small class="wx2-place">' + App.esc(place) + '</small>' +
      '<b class="wx2-t">' + w.temp + '°</b><span class="wx2-c">' + App.esc(w.label) + '</span><span class="wx2-hi">high of ' + w.hi + '° · low ' + w.lo + '°</span></div>' +
      '<div class="bars">' + hours.map(function (h) {
        var f = tmax === tmin ? .6 : .22 + (h.t - tmin) / (tmax - tmin) * .78;
        return '<span class="bar' + (h.p >= 50 ? ' is-wet' : '') + '"><small>' + h.t + '°</small><i style="height:' + Math.round(f * 100) + '%"></i><em>' + h.label + '</em></span>';
      }).join('') + '</div></div>' +
      '<p class="wx2-sum">' + App.esc(w.summary) + '.</p>' +
      '<div class="rain"><span class="tag">' + App.icon('drop', 14) + 'rain · next 12 hours</span><b>' + rain + '% <span>' + word + '</span></b>' +
      '<div class="scale"><i></i><i></i><i></i><i></i><i></i><em style="left:' + Math.max(2, Math.min(98, rain)) + '%"></em></div>' +
      '<small>' + facts.join(' · ') + '</small></div></div>';
  }

  // Next calendar event in the coming two weeks, else the shopping list
  function next() {
    var now = new Date(), until = App.addDays(App.dayStart(now), 15);
    var e = (D.events || []).filter(function (x) { return x.end > now && x.start < until; }).sort(function (a, b) { return a.start - b.start; })[0];
    if (e) {
      var days = Math.round((App.dayStart(e.start) - App.dayStart(now)) / 864e5), mins = (e.start - now) / 60000;
      var when = e.start <= now ? 'Happening now' : days === 0 ? (mins < 60 ? 'in ' + Math.max(1, Math.round(mins)) + ' min' : 'in ' + Math.round(mins / 60) + ' hr') : days === 1 ? 'tomorrow' : 'in ' + days + ' days';
      var who = (e.people || []).length >= App.people().length ? 'family' : (e.people || [])[0];
      return '<button class="tcard nx" data-go="calendar" style="' + App.pstyle(who || 'family') + '"><span class="tag">' + App.icon('calendar', 14) + (e.srcName ? App.esc(e.srcName) : 'Up next') + '</span>' +
        '<div class="nx-m"><span class="nx-ico">' + App.icon('calendar', 22) + '</span><b>' + App.esc(e.title) + (e.loc ? '<small>' + App.esc(e.loc) + '</small>' : '') + '</b></div>' +
        '<div class="pills"><span>' + App.fmt.dayShort(e.start) + (e.allDay ? ' · all day' : ' · ' + App.fmt.time(e.start).toLowerCase()) + '</span><span><i></i>' + when + '</span></div></button>';
    }
    var list = (D.groceries || []).filter(function (g) { return !g.done; });
    var counts = {};
    list.forEach(function (g) { counts[g.store || ''] = (counts[g.store || ''] || 0) + 1; });
    var named = (D.stores || []).filter(function (s) { return counts[s.id]; });
    return '<button class="tcard nx" data-go="shopping"><span class="tag">' + App.icon('cart', 14) + 'Shopping list</span>' +
      '<div class="nx-m"><span class="nx-ico">' + App.icon('cart', 22) + '</span><b>' + (list.length ? list.length + (list.length === 1 ? ' thing' : ' things') + ' to get' : 'All stocked up') +
      '<small>' + (list.length ? App.esc(list.slice(0, 4).map(function (g) { return g.name; }).join(', ')) + (list.length > 4 ? '…' : '') : 'Nothing on the list') + '</small></b></div>' +
      (named.length ? '<div class="pills">' + named.slice(0, 3).map(function (s) { return '<span><i></i>' + App.esc(s.name) + ' · ' + counts[s.id] + '</span>'; }).join('') + '</div>' : '') + '</button>';
  }

  // Today's chores and open reminders, tap to tick off
  function todos() {
    var t0 = +App.dayStart(new Date());
    var chores = (D.chores || []).map(function (c) { return { kind: 'chore', id: c.id, text: c.title, done: !!c.done }; });
    // This phone's person and the house (each person sees their own to-dos)
    var me = App.me();
    var rems = (D.todos || []).filter(function (t) { return (t.list === 'house' || !me || t.list === me) && (!t.done || (t.doneAt || 0) >= t0); }).map(function (t) { return { kind: 'todo', id: t.id, text: t.text, done: !!t.done }; });
    var all = chores.concat(rems).sort(function (a, b) { return (b.done ? 1 : 0) - (a.done ? 1 : 0); });
    var left = all.filter(function (x) { return !x.done; }).length;
    return '<div class="tcard td"><div class="td-h"><b>' + (rems.length ? 'To do,' : 'Chores,') + '</b> ' + (left ? left + ' left today' : 'all done') + '</div>' +
      (all.length ? '<div class="td-l">' + all.map(function (x) {
        return '<button class="' + (x.done ? 'is-done' : '') + '" data-' + x.kind + '="' + App.esc(x.id) + '"><i>' + (x.done ? App.icon('check', 12) : '') + '</i><span>' + App.esc(x.text) + '</span></button>';
      }).join('') + '</div>' : '<p class="muted">Nothing to do today.</p>') + '<button class="td-all" data-go="reminders">All to-dos ' + App.icon('right', 14) + '</button></div>';
  }
  function tickTodo(id) {
    D.todos = (D.todos || []).map(function (x) { return x.id === id ? Object.assign({}, x, { done: !x.done, doneAt: x.done ? null : Date.now() }) : x; });
    App.save(); App.rerender();
  }

  function trip(t, kind) {
    if (!t) return '';
    return '<span class="trip">' + App.icon(kind, 15) + '<b>' + t.min + '</b> min' + (t.delay > 0 ? '<em>+' + t.delay + '</em>' : '') + '</span>';
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
    return '<div class="tcard bart"><div class="t-h"><h2>BART, <i>next trains</i></h2>' + (B.updated ? '<small>' + App.fmt.time(new Date(B.updated)) + '</small>' : '') + '</div>' +
      (B.advisory ? '<button class="adv" data-adv>' + App.icon('bell', 16) + '<span>' + App.esc(B.advisory) + '</span></button>' : '') + body + '</div>';
  }
  function mmss(ms) { var s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2); }
  function music() {
    var M = D.music || {};
    if (!M.connected) return '';
    if (!M.title) return '<button class="tcard np np--empty" data-go="music">' + App.icon('music', 24) + '<span><b>Nothing playing</b><small>Tap to pick a playlist</small></span></button>';
    return '<div class="tcard np2">' +
      (M.art ? '<img class="np2-art" src="' + App.esc(M.art) + '" alt="" data-go="music">' : '<span class="np2-art" data-go="music">' + App.icon('music', 26) + '</span>') +
      '<div class="np2-m"><span class="tag" data-go="music">' + App.icon('speaker', 13) + (M.playing ? 'Now playing' : 'Last played') + '</span>' +
      '<b data-go="music">' + App.esc(M.title) + '</b><span>' + App.esc(M.artist) + '</span>' +
      '<div class="np2-p"><em class="np2-pos">' + mmss(App.musicProgress(M) / 100 * (M.duration || 0)) + '</em><div class="np-prog2"><i style="width:' + App.musicProgress(M) + '%"></i></div><em>' + (M.duration ? mmss(M.duration) : '') + '</em></div>' +
      '<div class="np2-c"><button data-m="prev" aria-label="Previous">' + App.icon('prev', 20) + '</button>' +
      '<button class="np2-play" data-m="' + (M.playing ? 'pause' : 'play') + '" aria-label="Play or pause">' + App.icon(M.playing ? 'pause' : 'play', 22) + '</button>' +
      '<button data-m="next" aria-label="Next">' + App.icon('next', 20) + '</button></div></div></div>';
  }
  function notes() {
    var ns = (D.notes || []).filter(function (n) { return n.pinned && !n.done; }).slice(0, 3);
    if (!ns.length) return '';
    return '<div class="tcard"><div class="card-h">' + App.icon('pin', 18) + '<span>Pinned notes</span></div>' + ns.map(function (n) {
      return '<button class="mini-note" data-go="notes" style="' + App.pstyle(n.by) + '"><i></i><span>' + App.esc(n.text) + '</span></button>';
    }).join('') + '</div>';
  }

  App.screen('today', {
    render: function (el) {
      el.innerHTML = '<div class="today">' + hero() + weather() + next() + '<div class="slot-todo">' + todos() + '</div>' +
        '<div class="slot-bart">' + bart() + '</div><div class="slot-music">' + music() + '</div>' + notes() + '</div>';
      if (!el.dataset.wired) {
        el.dataset.wired = '1';
        el.addEventListener('click', function (e) {
          var t;
          if ((t = e.target.closest('[data-m]'))) return App.musicCmd(t.dataset.m);
          if ((t = e.target.closest('[data-todo]'))) return tickTodo(t.dataset.todo);
          if (e.target.closest('[data-chore]')) return App.go('chores');
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
    if (App.current !== 'today' || !D.music) return;
    var bar = App.$('.scr[data-scr="today"] .np-prog2 i'), pos = App.$('.scr[data-scr="today"] .np2-pos');
    if (bar) bar.style.width = App.musicProgress(D.music) + '%';
    if (pos) pos.textContent = mmss(App.musicProgress(D.music) / 100 * (D.music.duration || 0));
  });
  App.on('minute', function () { if (App.current === 'today' && !document.querySelector('#sheetLayer.is-open')) App.rerender(); });
})();
