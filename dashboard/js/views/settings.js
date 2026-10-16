// Settings on the frame: night mode (red, no blue light) schedule and the lock screen.
// Saved in DATA.display, shared with every screen through the Mac mini.
(function () {
  'use strict';
  var D = window.DATA;
  var V = { el: null, rep: null, repT: null };
  var STEP = 15; // minutes per tap on − / +

  function cfg() { return App.displayCfg(); }
  function save(c) {
    D.display = { night: c.night, lockAfter: c.lockAfter, lock: c.lock };
    App.emit('data');
    paint();
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function shift(hhmm, d) {
    var m = (App.toMin(hhmm) + d + 1440) % 1440;
    m = Math.round(m / STEP) * STEP % 1440;
    return pad(Math.floor(m / 60)) + ':' + pad(m % 60);
  }
  function seg(name, opts, cur) {
    return '<div class="seg st-seg">' + opts.map(function (o) {
      return '<button data-' + name + '="' + o[0] + '" class="' + (String(o[0]) === String(cur) ? 'is-on' : '') + '">' + o[1] + '</button>';
    }).join('') + '</div>';
  }
  function timeBox(which, label, val, off) {
    var t = App.fmtHHMM(val).split(' ');
    return '<div class="st-time' + (off ? ' is-off' : '') + '"><div class="label">' + label + '</div>' +
      '<div class="st-time-row"><button class="st-step" data-step="' + which + '" data-d="-1" aria-label="Earlier">' + App.icon('minus', 28) + '</button>' +
      '<div class="st-clock"><b class="num">' + t[0] + '</b><span>' + t[1] + '</span></div>' +
      '<button class="st-step" data-step="' + which + '" data-d="1" aria-label="Later">' + App.icon('plus', 28) + '</button></div></div>';
  }
  function status(c) {
    var n = c.night, on = App.isNight();
    if (n.mode === 'on') return 'Night mode is on all the time.';
    if (n.mode === 'off') return 'Night mode is off. The lock screen still switches to its night look between these times.';
    if (n.from === n.to) return 'Pick two different times to use the schedule.';
    return on ? 'On now · switches back to day at <b>' + App.fmtHHMM(n.to) + '</b>.' : 'Turns on tonight at <b>' + App.fmtHHMM(n.from) + '</b>.';
  }
  // Lock screen look: wallpaper thumbnails + night / details / clock style
  function lockLook(L) {
    var wp = function (id, label, sub, img) {
      return '<button class="st-wp' + (L.wallpaper === id ? ' is-on' : '') + '" data-wallpaper="' + id + '">' +
        '<span class="st-wp-img" style="' + img + '"></span><b>' + label + '</b><small>' + sub + '</small></button>';
    };
    return '<section class="card st-card st-card--wide">' +
      '<div class="st-title"><span class="st-ico">' + App.icon('photo', 28) + '</span><div><h3>Lock screen</h3><p>What the frame shows when it’s locked.</p></div>' +
      '<button class="btn st-try" data-lock>' + App.icon('lock', 22) + 'Try it</button></div>' +
      '<div class="st-look">' +
        '<div class="st-wps">' +
          wp('scene', 'Henley Gate', 'Pixel scene · day & night', 'background-image:url(/lock/henley-day.jpg?v=2)') +
          wp('photos', 'Photos', 'Your photo slideshow', 'background-image:linear-gradient(135deg,#B9A58C,#6E8069)') +
        '</div>' +
        '<div class="st-opts">' +
          '<div class="st-row"><div class="label">At night</div>' + seg('locknight', [['scene', L.wallpaper === 'scene' ? 'Night scene' : 'Photos'], ['red', 'Red clock (no blue light)']], L.night) + '</div>' +
          '<div class="st-row"><div class="label">Show</div>' + seg('lockdetails', [['full', 'Clock, weather & next event'], ['clock', 'Just the clock']], L.details) + '</div>' +
          (L.wallpaper === 'scene' ? '<div class="st-row"><div class="label">Clock style</div>' + seg('lockfont', [['pixel', 'Pixel'], ['classic', 'Classic']], L.font) + '</div>' : '') +
        '</div>' +
      '</div></section>';
  }

  function paint() {
    if (!V.el) return;
    var c = cfg(), n = c.night, auto = n.mode === 'auto';
    V.el.innerHTML = '<div class="st">' +
      '<header class="st-head"><h2 class="serif">Settings</h2><span class="label">This frame and every other screen</span></header>' +
      '<div class="st-cols">' +
      '<section class="card st-card">' +
      '<div class="st-title"><span class="st-ico st-ico--night">' + App.icon('moon', 28) + '</span><div><h3>Night mode</h3><p>Red on black with no blue light, like the night mode on Apple Watch.</p></div></div>' +
      seg('nmode', [['auto', 'Scheduled'], ['on', 'Always on'], ['off', 'Off']], n.mode) +
      '<div class="st-times">' + timeBox('from', 'Turns on', n.from, !auto) + '<span class="st-arrow">' + App.icon('right', 26) + '</span>' + timeBox('to', 'Turns off', n.to, !auto) + '</div>' +
      '<div class="st-row"><div class="label">Brightness</div>' + seg('level', [['dim', 'Dim'], ['medium', 'Medium'], ['bright', 'Bright']], n.level) + '</div>' +
      '<div class="st-foot"><p class="st-status">' + status(c) + '</p><button class="btn" data-preview>' + App.icon('moon', 22) + 'Preview</button></div>' +
      '</section>' +
      '<section class="card st-card">' +
      '<div class="st-title"><span class="st-ico">' + App.icon('lock', 28) + '</span><div><h3>Locking</h3><p>The lock screen follows the night-mode schedule on its own. Tap it to wake.</p></div></div>' +
      '<button class="btn btn--solid st-lock" data-lock>' + App.icon('lock', 24) + 'Lock now</button>' +
      '<div class="st-row"><div class="label">Lock automatically after</div>' +
      seg('autolock', [[60, '1 min'], [120, '2 min'], [300, '5 min'], [600, '10 min'], [0, 'Never']], c.lockAfter) + '</div>' +
      '<p class="st-tip">' + App.icon('clock', 20) + '<span>Press and hold the clock in the bottom-left corner to lock from any tab.</span></p>' +
      '</section>' +
      lockLook(c.lock) +
      '</div></div>';
  }

  function step(which, d) {
    var c = cfg();
    if (c.night.mode !== 'auto') c.night.mode = 'auto';
    c.night[which] = shift(c.night[which], d * STEP);
    save(c);
  }
  function stopRepeat() { clearTimeout(V.repT); clearInterval(V.rep); V.repT = V.rep = null; }

  function onDown(e) {
    var b = e.target.closest('[data-step]');
    if (!b) return;
    e.preventDefault();
    var which = b.dataset.step, d = +b.dataset.d;
    step(which, d);
    stopRepeat();
    // Keep holding to scroll through the times quickly.
    V.repT = setTimeout(function () { V.rep = setInterval(function () { step(which, d); }, 110); }, 450);
    setTimeout(stopRepeat, 20000);
  }
  function onClick(e) {
    var b = e.target.closest('button');
    if (!b) return;
    var c = cfg();
    if (b.dataset.nmode) { c.night.mode = b.dataset.nmode; return save(c); }
    if (b.dataset.level) { c.night.level = b.dataset.level; save(c); if (!App.isNight()) App.previewNight(4); return; }
    if (b.dataset.autolock != null) { c.lockAfter = +b.dataset.autolock; return save(c); }
    if (b.dataset.wallpaper) { c.lock.wallpaper = b.dataset.wallpaper; return save(c); }
    if (b.dataset.locknight) { c.lock.night = b.dataset.locknight; return save(c); }
    if (b.dataset.lockdetails) { c.lock.details = b.dataset.lockdetails; return save(c); }
    if (b.dataset.lockfont) { c.lock.font = b.dataset.lockfont; return save(c); }
    if (b.hasAttribute('data-lock')) return App.lock();
    if (b.hasAttribute('data-preview')) { App.previewNight(8); App.toast('Night mode preview · 8 seconds', { icon: 'moon', ms: 2500 }); }
  }

  App.register('settings', {
    show: function (el) {
      V.el = el;
      if (!el.dataset.wired) {
        el.dataset.wired = '1';
        el.addEventListener('pointerdown', onDown);
        el.addEventListener('click', onClick);
        ['pointerup', 'pointercancel'].forEach(function (t) { document.addEventListener(t, stopRepeat, true); });
      }
      paint();
    }
  });
  App.on('minute', function () { if (App.current === 'settings') paint(); });
  App.on('night', function () { if (App.current === 'settings') paint(); });
})();
