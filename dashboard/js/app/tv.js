// Apple TV remote on the phone: the Mac mini talks to the TV, so it works from anywhere.
// Swipe on the touch pad (like the Siri remote) or use the arrows; tap the pad to select.
(function () {
  'use strict';
  var D = window.DATA;

  function key(name, extra) {
    if (navigator.vibrate) navigator.vibrate(8);
    return App.post('/api/home/tv/key', Object.assign({ name: name }, extra || {})).catch(function (e) { App.toast(App.esc(e.message), { tone: 'error', icon: 'tv', ms: 2500 }); });
  }
  function now(T) {
    var P = T.playing || {};
    if (!T.connected) return '<b>Not connected</b><small>' + App.esc(T.error || 'The Mac mini is trying to reach the Apple TV') + '</small>';
    if (T.power === 'off') return '<b>Asleep</b><small>Tap power to wake it</small>';
    if (P.title) return '<b>' + App.esc(P.title) + '</b><small>' + App.esc([P.artist, T.app && T.app.name].filter(Boolean).join(' · ')) + '</small>';
    return '<b>' + App.esc(T.app ? T.app.name : 'Home screen') + '</b><small>Apple TV is on</small>';
  }
  function apps() {
    App.sheet('<div class="sh-pad"><h2 class="sh-h">Open an app</h2><div class="chips tv-applist"><span class="muted">Loading…</span></div></div>', {
      tall: true,
      onMount: function (s, close) {
        App.get('/api/home/tv/apps').then(function (list) {
          s.querySelector('.tv-applist').innerHTML = list.map(function (a) { return '<button class="chip" data-app="' + App.esc(a.id) + '">' + App.esc(a.name) + '</button>'; }).join('');
        }).catch(function (e) { s.querySelector('.tv-applist').innerHTML = '<span class="muted">' + App.esc(e.message) + '</span>'; });
        s.addEventListener('click', function (e) {
          var b = e.target.closest('[data-app]'); if (!b) return;
          close(); App.toast('Opening <b>' + App.esc(b.textContent) + '</b>', { icon: 'tv', ms: 1800 });
          App.post('/api/home/tv/launch', { id: b.dataset.app }).catch(function (er) { App.toast(App.esc(er.message), { tone: 'error', icon: 'tv' }); });
        });
      }
    });
  }
  function pad(el) {
    // Swipe = arrow, tap = select (like the Siri remote's touch surface)
    var p = el.querySelector('.tvp-touch'); if (!p) return;
    var x0, y0, t0;
    p.addEventListener('touchstart', function (e) { if (e.target.closest('button')) { x0 = null; return; } var t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; t0 = Date.now(); }, { passive: true });
    p.addEventListener('touchend', function (e) {
      if (x0 == null) return;
      var t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0; x0 = null;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) { key('select', Date.now() - t0 > 600 ? { hold: true } : null); return; }
      key(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    });
    p.addEventListener('click', function (e) { if (e.target.closest('button')) return; if (!('ontouchstart' in window)) key('select'); });
  }

  App.screen('tv', {
    tab: 'more',
    render: function (el) {
      var T = D.tv || {};
      if (!T.paired) {
        el.innerHTML = '<button class="back" data-go="more">' + App.icon('left', 20) + 'More</button>' + App.head('Apple TV') +
          '<div class="empty">' + App.icon('tv', 30) + '<b>Not paired yet</b><span>Pair the Apple TV once in Admin → Lights &amp; Home, then control it here and on the frame.</span></div>';
      } else {
        var P = T.playing || {};
        el.innerHTML = '<button class="back" data-go="home">' + App.icon('left', 20) + 'Home</button>' +
          App.head(App.esc(T.name || 'Apple TV'), '', '<button class="tvp-pw' + (T.power === 'off' ? '' : ' is-on') + '" data-pw aria-label="Power">' + App.icon('power', 22) + '</button>') +
          '<div class="card tvp-now">' + now(T) + '</div>' +
          '<div class="tvp-touch" role="button" aria-label="Touch pad: swipe to move, tap to select"><span>Swipe to move · tap to select</span>' +
          '<button class="tvp-a tvp-u" data-k="up" aria-label="Up">' + App.icon('up', 22) + '</button><button class="tvp-a tvp-d" data-k="down" aria-label="Down">' + App.icon('down', 22) + '</button>' +
          '<button class="tvp-a tvp-l" data-k="left" aria-label="Left">' + App.icon('left', 22) + '</button><button class="tvp-a tvp-r" data-k="right" aria-label="Right">' + App.icon('right', 22) + '</button></div>' +
          '<div class="tvp-row"><button data-k="menu">' + App.icon('left', 20) + '<span>Back</span></button><button data-k="home">' + App.icon('tv', 20) + '<span>TV</span></button>' +
          '<button data-k="play_pause">' + App.icon(P.playing ? 'pause' : 'play', 20) + '<span>' + (P.playing ? 'Pause' : 'Play') + '</span></button></div>' +
          '<div class="tvp-row"><button data-k="volume_down">' + App.icon('minus', 20) + '<span>Vol</span></button><button data-k="volume_up">' + App.icon('plus', 20) + '<span>Vol</span></button>' +
          '<button data-apps>' + App.icon('sliders', 20) + '<span>Apps</span></button></div>' +
          '<p class="foot">Hold the touch pad for a long press. The Mac mini relays every button, so this works away from home too.</p>';
        pad(el);
      }
      if (!el.dataset.wired) {
        el.dataset.wired = '1';
        el.addEventListener('click', function (e) {
          var t;
          if ((t = e.target.closest('[data-go]'))) return App.go(t.dataset.go);
          if ((t = e.target.closest('[data-k]'))) { e.stopPropagation(); return key(t.dataset.k); }
          if (e.target.closest('[data-apps]')) return apps();
          if (e.target.closest('[data-pw]')) {
            var on = (D.tv || {}).power === 'off';
            return App.post('/api/home/tv/power', { on: on }).then(function () { App.toast(on ? 'Waking the Apple TV' : 'Apple TV going to sleep', { icon: 'tv', ms: 1800 }); })
              .catch(function (er) { App.toast(App.esc(er.message), { tone: 'error', icon: 'tv' }); });
          }
        });
      }
    },
    live: function (keys) {
      if (keys.indexOf('tv') < 0) return;
      var el = App.$('.scr[data-scr="tv"]'); if (!el) return;
      var box = el.querySelector('.tvp-now'), T = D.tv || {};
      if (box) box.innerHTML = now(T); else App.rerender();
      var pw = el.querySelector('.tvp-pw'); if (pw) pw.classList.toggle('is-on', T.power !== 'off');
    }
  });
})();
