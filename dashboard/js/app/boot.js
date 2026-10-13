// Start-up: sign in once with the household PIN, pick who you are, then show the tabs.
(function () {
  'use strict';
  var $ = App.$;
  var started = false;

  function full(html) {
    var b = $('#boot'); if (b) b.remove();
    $('#tabs').hidden = true;
    $('#screens').innerHTML = '<section class="scr scr--full">' + html + '</section>';
  }

  function offline(msg) {
    full('<div class="gate"><div class="gate-mark">' + App.icon('home', 34) + '</div><h1>Can’t reach home</h1>' +
      '<p>' + App.esc(msg || 'The Mac mini isn’t answering. Check your connection and try again.') + '</p>' +
      '<button class="btn btn--solid btn--wide" data-retry>Try again</button></div>');
    $('[data-retry]').onclick = function () { location.reload(); };
  }

  function login(err) {
    var title = (window.DATA.settings && window.DATA.settings.title) || 'Home';
    full('<form class="gate" autocomplete="on"><div class="gate-mark">' + App.icon('home', 34) + '</div>' +
      '<h1>' + App.esc(title) + '</h1><p>Enter the household PIN to use this phone with the frame. You’ll stay signed in.</p>' +
      '<input class="gate-pin" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="current-password" name="pin" placeholder="PIN" maxlength="12" required>' +
      (err ? '<p class="gate-err">' + App.esc(err) + '</p>' : '') +
      '<button class="btn btn--solid btn--wide" type="submit">Sign in</button>' +
      '<p class="gate-note">Same PIN as the admin page.</p></form>');
    var f = $('.gate'), input = f.querySelector('input');
    setTimeout(function () { input.focus(); }, 50);
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = f.querySelector('button'); btn.disabled = true; btn.textContent = 'Signing in…';
      App.post('/api/login', { pin: input.value, app: true })
        .then(function () { return App.get('/api/me'); })
        .then(function (me) { if (!me.admin) throw new Error('Sign-in didn’t stick. Check that cookies are allowed.'); whoAmI(); })
        .catch(function (e2) { login(e2.message); });
    });
  }

  function whoAmI() {
    if (App.me()) return start();
    full('<div class="gate"><h1>Who’s this?</h1><p>So notes and games know it’s you. You can change it later in Settings.</p>' +
      '<div class="gate-who">' + App.people().map(function (p) {
        return '<button class="gate-person" data-me="' + App.esc(p.id) + '" style="' + App.pstyle(p) + '">' + App.avatar(p, 64) + '<b>' + App.esc(p.name) + '</b></button>';
      }).join('') + '</div></div>');
    App.$$('[data-me]').forEach(function (b) { b.onclick = function () { App.setMe(b.dataset.me); start(); }; });
  }

  function start() {
    if (started) { App.go(App.current || 'today'); return; }
    started = true;
    var b = $('#boot'); if (b) b.remove();
    $('#screens').innerHTML = '';
    $('#tabs').hidden = false;
    $('#tabs').addEventListener('click', function (e) {
      var t = e.target.closest('[data-tab]'); if (!t) return;
      if (App.current === t.dataset.tab) { window.scrollTo({ top: 0, behavior: 'smooth' }); var d = App.screens[App.current]; if (d && d.reset) { d.reset(); App.rerender(); } return; }
      App.go(t.dataset.tab);
    });
    window.addEventListener('hashchange', function () { var n = location.hash.slice(1); if (n && n !== App.current) App.go(n); });
    if (window.HQ && HQ.attach) HQ.attach();
    App.go(location.hash.slice(1) || 'today');
    var lastMin = -1;
    setInterval(function () {
      var n = new Date();
      App.emit('second', n);
      if (n.getMinutes() !== lastMin) { lastMin = n.getMinutes(); App.emit('minute', n); }
    }, 1000);
    // Coming back to the app after a while: catch up on anything that changed.
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      if (window.HQ && HQ.refresh) HQ.refresh().catch(function () {});
    });
  }

  (window.HQ_READY || Promise.resolve()).then(function () {
    if (!window.HQ || !HQ.online()) return offline();
    return App.get('/api/me').then(function (me) { if (me.admin) whoAmI(); else login(); });
  }).catch(function (e) { offline(e.message); });
})();
