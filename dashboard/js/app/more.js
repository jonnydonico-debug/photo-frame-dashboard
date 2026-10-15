// More: everything else the frame has — Calendar, Chores, Recipes, Map, Photos, Games, Home
// controls, Apple TV, Agents, Costs — and Settings (the frame's night mode + lock, who you are).
(function () {
  'use strict';
  var D = window.DATA;

  App.screen('more', {
    render: function (el) {
      var ps = (D.photos || []).filter(function (p) { return p.src; }).length;
      var live = D.games && D.games.chess && D.games.chess.current && !D.games.chess.current.over;
      var on = (D.devices || []).filter(function (d) { return d.type === 'light' && d.on; }).length;
      var t0 = new Date(); t0.setHours(0, 0, 0, 0);
      var evs = (D.events || []).filter(function (e) { return e.end > t0 && e.start < +t0 + 7 * 864e5; }).length;
      var chores = (D.chores || []).filter(function (c) { return !c.done; }).length;
      var C = D.costs;
      el.innerHTML = App.head('More') + '<div class="sec-l">Plans</div><div class="group menu">' +
        item('calendar', 'calendar', 'Calendar', evs ? evs + ' this week' : 'Nothing this week') +
        item('chores', 'tasks', 'Chores', chores ? chores + ' left to do' : 'All done') +
        item('recipes', 'utensils', 'Recipes', (D.recipes || []).length ? D.recipes.length + ' saved' : 'Text Dommy a recipe to save it') +
        item('map', 'map', 'Map', 'Drive and walk times from home') + '</div>' +
        '<div class="sec-l">House</div><div class="group menu">' +
        item('photos', 'photo', 'Photos', ps ? ps + ' photos' : 'Shared album') +
        item('games', 'star', 'Games', live ? 'Chess game in progress' : 'Chess') +
        item('home', 'sliders', 'Home', (D.devices || []).length ? (on ? on + ' lights on' : 'Lights and scenes') : 'Lights, locks, scenes') +
        (D.tv && D.tv.paired ? item('tv', 'tv', 'Apple TV', D.tv.connected ? (D.tv.power === 'off' ? 'Asleep' : 'Remote') : 'Not connected') : '') +
        '</div><div class="sec-l">Agents</div><div class="group menu">' +
        item('agents', 'robot', 'Agents', 'Your Claude team and what they did') +
        item('costs', 'coin', 'Costs', C && C.month ? money(C.month.cost) + ' on the Claude API this month' : 'Claude API spending') +
        '</div><div class="sec-l"></div><div class="group menu">' +
        item('settings', 'clock', 'Settings', 'Night mode, lock screen, you') + '</div>';
      if (!el.dataset.wired) {
        el.dataset.wired = '1';
        el.addEventListener('click', function (e) { var t = e.target.closest('[data-go]'); if (t) App.go(t.dataset.go); });
      }
    }
  });
  function money(v) { return !v ? '$0' : v < 0.995 ? Math.round(v * 100) + '¢' : '$' + v.toFixed(2); }
  function item(go, icon, title, sub) {
    return '<button class="menu-i" data-go="' + go + '"><span class="menu-ico">' + App.icon(icon, 20) + '</span><span><b>' + title + '</b><small>' + App.esc(sub) + '</small></span>' + App.icon('right', 18) + '</button>';
  }

  // ------------------------------------------------------------ settings
  var NIGHT = { mode: 'auto', from: '21:30', to: '06:30', level: 'medium' };
  function cfg() { var d = D.display || {}; return { night: Object.assign({}, NIGHT, d.night || {}), lockAfter: d.lockAfter == null ? 120 : d.lockAfter }; }
  function store(c) { D.display = { night: c.night, lockAfter: c.lockAfter }; App.save(); App.rerender(); }
  function shift(hhmm, d) { var p = hhmm.split(':'), m = ((+p[0] * 60 + +p[1] + d) % 1440 + 1440) % 1440; m = Math.round(m / 15) * 15 % 1440; return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + m % 60).slice(-2); }
  function seg(attr, opts, cur) { return '<div class="seg seg--full">' + opts.map(function (o) { return '<button data-' + attr + '="' + o[0] + '" class="' + (String(o[0]) === String(cur) ? 'is-on' : '') + '">' + o[1] + '</button>'; }).join('') + '</div>'; }
  function time(which, label, v, off) {
    return '<div class="tm' + (off ? ' is-off' : '') + '"><small>' + label + '</small><div class="tm-row"><button data-step="' + which + '" data-d="-15" aria-label="Earlier">' + App.icon('minus', 18) + '</button><b>' + App.fmt.hhmm(v) + '</b><button data-step="' + which + '" data-d="15" aria-label="Later">' + App.icon('plus', 18) + '</button></div></div>';
  }

  App.screen('settings', {
    tab: 'more',
    render: function (el) {
      var c = cfg(), n = c.night, me = App.me();
      el.innerHTML = '<button class="back" data-go="more">' + App.icon('left', 20) + 'More</button>' + App.head('Settings') +
        '<div class="sec-l">This phone</div><div class="card"><p class="muted">You are</p><div class="who">' + App.people().map(function (p) {
          return '<button data-me="' + App.esc(p.id) + '" class="' + (p.id === me ? 'is-on' : '') + '" style="' + App.pstyle(p) + '">' + App.avatar(p, 30) + '<b>' + App.esc(p.name) + '</b></button>';
        }).join('') + '</div></div>' +
        '<div class="sec-l">Frame · night mode</div><div class="card st">' +
        '<p class="muted">Red on black with no blue light. Applies to the frame and every screen.</p>' +
        seg('nm', [['auto', 'Scheduled'], ['on', 'Always'], ['off', 'Off']], n.mode) +
        '<div class="tms">' + time('from', 'Turns on', n.from, n.mode !== 'auto') + time('to', 'Turns off', n.to, n.mode !== 'auto') + '</div>' +
        '<p class="muted">Brightness</p>' + seg('lv', [['dim', 'Dim'], ['medium', 'Medium'], ['bright', 'Bright']], n.level) + '</div>' +
        '<div class="sec-l">Frame · lock screen</div><div class="card st"><p class="muted">Lock automatically after</p>' +
        seg('lk', [[60, '1 min'], [120, '2 min'], [300, '5 min'], [600, '10 min'], [0, 'Never']], c.lockAfter) + '</div>' +
        '<div class="sec-l">Account</div><div class="group menu">' +
        '<a class="menu-i" href="/admin" target="_blank" rel="noopener"><span class="menu-ico">' + App.icon('sliders', 20) + '</span><span><b>Admin</b><small>Calendar, family, Spotify, photos setup</small></span>' + App.icon('right', 18) + '</a>' +
        '<button class="menu-i" data-signout><span class="menu-ico">' + App.icon('lock', 20) + '</span><span><b>Sign out of this phone</b><small>You’ll need the PIN again</small></span></button></div>' +
        '<p class="foot">Changes sync with the frame instantly.</p>';
      if (!el.dataset.wired) {
        el.dataset.wired = '1';
        el.addEventListener('click', function (e) {
          var t, c2 = cfg();
          if ((t = e.target.closest('[data-go]'))) return App.go(t.dataset.go);
          if ((t = e.target.closest('[data-me]'))) { App.setMe(t.dataset.me); App.toast('Hi ' + App.esc(App.person(t.dataset.me).name), { icon: 'person', ms: 1500 }); return App.rerender(); }
          if ((t = e.target.closest('[data-nm]'))) { c2.night.mode = t.dataset.nm; return store(c2); }
          if ((t = e.target.closest('[data-lv]'))) { c2.night.level = t.dataset.lv; return store(c2); }
          if ((t = e.target.closest('[data-lk]'))) { c2.lockAfter = +t.dataset.lk; return store(c2); }
          if ((t = e.target.closest('[data-step]'))) { c2.night.mode = 'auto'; c2.night[t.dataset.step] = shift(c2.night[t.dataset.step], +t.dataset.d); return store(c2); }
          if (e.target.closest('[data-signout]')) return App.confirm('Sign out?', 'This phone will need the PIN again.', 'Sign out', function () {
            App.post('/api/logout').finally(function () { try { localStorage.removeItem('hq.app.me'); } catch (x) {} location.reload(); });
          }, true);
        });
      }
    }
  });
})();
