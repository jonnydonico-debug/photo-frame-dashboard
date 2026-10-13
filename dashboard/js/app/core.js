// Phone companion: the shared shell. Same data and live sync as the wall frame (js/sync.js),
// laid out for a phone. Screens register with App.screen(name, {title, render, live}).
(function () {
  'use strict';
  window.DATA = window.DATA || {};
  window.HQ_EXTRA_PUSH = ['photos'];        // signed in, so favourites can be saved too
  var D = window.DATA;
  var App = window.App = { screens: {}, current: null, mode: 'day', stack: [] };
  var $ = App.$ = function (s, r) { return (r || document).querySelector(s); };
  App.$$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  // ------------------------------------------------------------ events
  var handlers = {};
  App.on = function (e, fn) { (handlers[e] = handlers[e] || []).push(fn); };
  App.emit = function (e, a) { (handlers[e] || []).forEach(function (fn) { try { fn(a); } catch (err) { console.error(err); } }); };
  App.setMode = function (m) { App.mode = m; };

  // ------------------------------------------------------------ text + time
  App.esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  App.now = function () { return new Date(); };
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  App.fmt = {
    time: function (d, ampm) { var h = d.getHours(), m = d.getMinutes(), s = (h % 12 || 12) + ':' + (m < 10 ? '0' : '') + m; return ampm === false ? s : s + ' ' + (h >= 12 ? 'PM' : 'AM'); },
    ampm: function (d) { return d.getHours() >= 12 ? 'PM' : 'AM'; },
    day: function (d) { return DAYS[d.getDay()]; },
    dayShort: function (d) { return DAYS[d.getDay()].slice(0, 3); },
    month: function (d) { return MONTHS[d.getMonth()]; },
    monthShort: function (d) { return MONTHS[d.getMonth()].slice(0, 3); },
    mins: function (m) { m = Math.max(0, Math.round(m)); if (m < 60) return m + ' min'; var h = Math.floor(m / 60), r = m % 60; return h + ' hr' + (r ? ' ' + r + ' min' : ''); },
    ago: function (t) {
      var m = Math.round((Date.now() - t) / 60000);
      if (m < 1) return 'just now'; if (m < 60) return m + ' min ago';
      var h = Math.round(m / 60); if (h < 24) return h + ' hr ago';
      var d = new Date(t); return App.fmt.dayShort(d) + ', ' + App.fmt.monthShort(d) + ' ' + d.getDate();
    },
    hhmm: function (hhmm) { var p = String(hhmm).split(':'); return App.fmt.time(new Date(2000, 0, 1, +p[0] || 0, +p[1] || 0)); }
  };

  // ------------------------------------------------------------ icons + people
  App.icon = function (name, size, cls) {
    size = size || 22;
    return '<svg class="i ' + (cls || '') + '" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ((window.ICONS || {})[name] || '') + '</svg>';
  };
  var FALLBACK = [{ id: 'jd', name: 'JD', color: '#6E8069', rgb: '110 128 105', ink: '#FFFFFF' }, { id: 'georgia', name: 'Georgia', color: '#A8644A', rgb: '168 100 74', ink: '#FFFFFF' }];
  App.people = function () { return D.people && D.people.length ? D.people : FALLBACK; };
  App.person = function (id) { var ps = App.people(); for (var i = 0; i < ps.length; i++) if (ps[i].id === id) return ps[i]; return { id: id || '?', name: '?', color: '#8A8276', rgb: '138 130 118', ink: '#fff' }; };
  App.pstyle = function (p) { if (typeof p === 'string') p = App.person(p); return '--c:' + p.color + ';--c-rgb:' + p.rgb + ';--c-ink:' + (p.ink || '#fff'); };
  App.avatar = function (p, size) {
    if (typeof p === 'string') p = App.person(p);
    size = size || 36;
    return '<span class="av" style="' + App.pstyle(p) + ';width:' + size + 'px;height:' + size + 'px;font-size:' + Math.round(size * .44) + 'px">' + App.esc((p.name || '?')[0]) + '</span>';
  };
  App.me = function () { try { var id = localStorage.getItem('hq.app.me'); if (id && App.people().some(function (p) { return p.id === id; })) return id; } catch (e) {} return null; };
  App.setMe = function (id) { try { localStorage.setItem('hq.app.me', id); } catch (e) {} };

  // ------------------------------------------------------------ network
  App.get = function (url) {
    return fetch(url, { cache: 'no-store', credentials: 'same-origin' }).then(function (r) {
      return r.text().then(function (t) { var j = {}; try { j = JSON.parse(t); } catch (e) {} if (!r.ok) throw new Error(j.error || 'Couldn’t reach home'); return j; });
    });
  };
  App.post = function (url, body) {
    return fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-HQ': '1' }, body: JSON.stringify(body || {}) }).then(function (r) {
      return r.text().then(function (t) { var j = {}; try { j = JSON.parse(t); } catch (e) {} if (!r.ok) throw new Error(j.error || 'Couldn’t reach home'); return j; });
    });
  };
  App.save = function () { App.emit('data'); };

  // ------------------------------------------------------------ toasts
  App.toast = function (html, opts) {
    opts = opts || {};
    var box = $('#toasts'), t = document.createElement('div');
    t.className = 'toast' + (opts.tone === 'error' ? ' toast--error' : '');
    t.innerHTML = (opts.icon ? App.icon(opts.icon, 20) : '') + '<span>' + html + '</span>' + (opts.undo ? '<button>Undo</button>' : '');
    box.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('is-in'); });
    var gone = false;
    function kill() { if (gone) return; gone = true; t.classList.remove('is-in'); setTimeout(function () { t.remove(); }, 250); }
    if (opts.undo) t.querySelector('button').onclick = function () { opts.undo(); kill(); };
    setTimeout(kill, opts.ms || (opts.undo ? 5000 : 2600));
  };

  // ------------------------------------------------------------ bottom sheets
  var sheetClose = null;
  App.sheet = function (html, opts) {
    opts = opts || {};
    App.closeSheet();
    var layer = $('#sheetLayer');
    layer.innerHTML = '<div class="sh-scrim"></div><div class="sh' + (opts.tall ? ' sh--tall' : '') + '" role="dialog"><div class="sh-grab"></div>' + html + '</div>';
    layer.classList.add('is-open');
    document.body.classList.add('no-scroll');
    var s = layer.querySelector('.sh');
    function close() {
      if (sheetClose !== close) return;
      sheetClose = null;
      layer.classList.remove('is-open');
      document.body.classList.remove('no-scroll');
      setTimeout(function () { if (!sheetClose) layer.innerHTML = ''; }, 260);
      if (opts.onClose) opts.onClose();
    }
    sheetClose = close;
    layer.querySelector('.sh-scrim').onclick = close;
    App.$$('[data-close]', s).forEach(function (b) { b.onclick = close; });
    // Swipe the sheet down to dismiss
    var y0 = null;
    s.querySelector('.sh-grab').addEventListener('touchstart', function (e) { y0 = e.touches[0].clientY; }, { passive: true });
    s.querySelector('.sh-grab').addEventListener('touchend', function (e) { if (y0 != null && e.changedTouches[0].clientY - y0 > 40) close(); y0 = null; });
    if (opts.onMount) opts.onMount(s, close);
    return close;
  };
  App.closeSheet = function () { if (sheetClose) sheetClose(); };
  App.confirm = function (title, text, label, fn, danger) {
    App.sheet('<div class="sh-pad"><h2 class="sh-h">' + title + '</h2>' + (text ? '<p class="sh-p">' + text + '</p>' : '') +
      '<div class="sh-actions"><button class="btn" data-close>Cancel</button><button class="btn ' + (danger ? 'btn--danger' : 'btn--solid') + '" data-ok>' + label + '</button></div></div>', {
      onMount: function (s, close) { s.querySelector('[data-ok]').onclick = function () { close(); fn(); }; }
    });
  };

  // ------------------------------------------------------------ weather helpers (same as the frame)
  App.hasWeather = function () { var W = D.weather; return !!(W && W.t && W.t.length >= 24); };
  App.weatherNow = function () {
    var W = D.weather, h = new Date().getHours();
    if (!App.hasWeather()) return { none: true, temp: '–', cond: 'cloud', label: 'No forecast yet', summary: 'Add your address in Admin', hi: '–', lo: '–' };
    var rainAt = -1;
    for (var i = h; i < 24; i++) if (W.p[i] >= 50) { rainAt = i; break; }
    var hour = function (x) { return (x % 12 || 12) + ' ' + (x >= 12 ? 'PM' : 'AM'); };
    var summary;
    if (rainAt === h) { var stop = h; while (stop < 24 && W.p[stop] >= 50) stop++; summary = 'Rain until ' + hour(stop % 24); }
    else if (rainAt > -1) summary = 'Rain from ' + hour(rainAt);
    else summary = W.t[h] < 12 ? 'Clear and cool' : 'Dry all day';
    var labels = { sun: 'Sunny', moon: 'Clear', partly: 'Partly cloudy', cloud: 'Overcast', rain: 'Rain' };
    return { temp: W.t[h], cond: W.c[h], label: labels[W.c[h]] || '', hi: W.hi, lo: W.lo, summary: summary, feels: W.feels, humidity: W.humidity, wind: W.wind, rain: W.p[h] };
  };
  App.hourly = function (n) {
    var W = D.weather, h = new Date().getHours(), out = [];
    if (!App.hasWeather()) return out;
    for (var i = 0; i < n && h + i < 24; i++) { var x = h + i; out.push({ t: W.t[x], c: W.c[x], p: W.p[x], label: i === 0 ? 'Now' : ((x % 12 || 12) + (x >= 12 ? 'p' : 'a')) }); }
    return out;
  };

  // ------------------------------------------------------------ music command (shared by Today + Music)
  App.musicCmd = function (action, extra) {
    var M = D.music || {};
    if (action === 'play' && !extra) { M.playing = true; M.at = Date.now(); App.emit('live', ['music']); }
    if (action === 'pause') { M.progress = (M.progress || 0) + (Date.now() - (M.at || Date.now())); M.at = Date.now(); M.playing = false; App.emit('live', ['music']); }
    return App.post('/api/music', Object.assign({ action: action }, extra || {})).catch(function (e) {
      var msg = /no active device|NO_ACTIVE_DEVICE|404/i.test(e.message) ? 'Pick a speaker first' : e.message;
      App.toast(App.esc(msg), { tone: 'error', icon: 'music', ms: 3500 });
    });
  };
  App.musicProgress = function (M) {
    if (!M || !M.duration) return 0;
    var p = (M.progress || 0) + (M.playing ? Date.now() - (M.at || Date.now()) : 0);
    return Math.max(0, Math.min(100, p / M.duration * 100));
  };

  // ------------------------------------------------------------ router
  App.screen = function (name, def) { App.screens[name] = def; };
  App.go = function (name, opts) {
    if (!App.screens[name]) name = 'today';
    var changed = App.current !== name;
    if (changed && App.current && App.screens[App.current].leave) App.screens[App.current].leave();
    App.current = name;
    App.$$('.tab').forEach(function (t) { t.classList.toggle('is-on', t.dataset.tab === (App.screens[name].tab || name)); });
    App.$$('.scr').forEach(function (s) { s.hidden = s.dataset.scr !== name; });
    paint(name);
    if (changed && !(opts && opts.keepScroll)) window.scrollTo(0, 0);
    if (location.hash.slice(1) !== name) history.replaceState(null, '', '#' + name);
  };
  function paint(name) {
    var def = App.screens[name], el = $('.scr[data-scr="' + name + '"]');
    if (!el) { el = document.createElement('section'); el.className = 'scr'; el.dataset.scr = name; $('#screens').appendChild(el); }
    el.hidden = false;
    def.render(el);
  }
  // Repaint the open screen after a change from another screen (the frame, the other phone)
  App.rerender = function () {
    if (!App.current) return;
    var y = window.scrollY;
    paint(App.current);
    window.scrollTo(0, y);
  };
  App.on('live', function (keys) { var d = App.screens[App.current]; if (d && d.live) d.live(keys); });

  // Big iOS-style title at the top of a screen
  App.head = function (title, sub, right) {
    return '<header class="hd"><div><h1>' + title + '</h1>' + (sub ? '<p>' + sub + '</p>' : '') + '</div>' + (right || '') + '</header>';
  };
})();
