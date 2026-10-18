// Lock screen. Two overlays:
//  - #ambient: the wallpaper with a clock. Wallpaper is the Henley Gate pixel scene (a day and a
//    night video that follow the night-mode schedule) or the photo slideshow.
//  - #night: the dim red clock (no blue light), used at night when Settings says so.
// Tap anywhere to unlock. Settings → Lock screen picks the look.
(function () {
  'use strict';
  var D = window.DATA, $ = App.$;
  var amb = { show: null, scene: null }, shiftTimer = null, primed = false;
  var SCENES = { day: '/lock/henley-day', night: '/lock/henley-night' };
  var VER = '?v=2'; // bump when the scene files change, so tablets and Cloudflare don't keep old copies
  // MP4 (H.264) where the browser can play it (lighter on tablets), WebM (VP9) otherwise or if it fails
  var fmt = null;
  function pickFmt(v) {
    if (fmt) return fmt;
    var mp4 = v.canPlayType('video/mp4; codecs="avc1.4D401F"'), webm = v.canPlayType('video/webm; codecs="vp9"');
    return (fmt = mp4 ? 'mp4' : webm ? 'webm' : 'mp4');
  }
  // Full resolution (1280×800 H.264) on screens that can take it, like an iPad; the light 576×360
  // version on the old wall tablet, whose decoder freezes on the big one. Settings → Lock screen.
  var hdFailed = false;
  App.sceneQuality = function () { var q = App.displayCfg().lock.quality; return q || (/Android/i.test(navigator.userAgent) ? 'light' : 'hd'); };
  function hd() { return App.sceneQuality() === 'hd' && !hdFailed; }
  // 4:3 screens (iPad) get the scenes drawn for them at 2732×2048; 16:10 screens the 1280×800 ones
  function tall() { return window.innerWidth / Math.max(1, window.innerHeight) < 1.5; }
  function variant() { return hd() ? (tall() ? '-ipad' : '-hd') : ''; }
  function srcFor(v, which) { return hd() && v.canPlayType('video/mp4') ? SCENES[which] + variant() + '.mp4' + VER : SCENES[which] + '.' + pickFmt(v) + VER; }

  function lockCfg() { return App.displayCfg().lock; }
  function sceneOn() { return lockCfg().wallpaper === 'scene'; }

  // ------------------------------------------------------------ info blocks
  function ambientInfo() {
    var n = App.now(), w = App.weatherNow(), next = App.nextEvent();
    return '<div class="amb-clock"><div class="amb-time num">' + App.fmt.time(n, false) + '</div>' +
      '<div class="amb-date">' + App.fmt.day(n) + ', ' + App.fmt.month(n) + ' ' + n.getDate() + '</div></div>' +
      (lockCfg().details === 'clock' ? '' : '<div class="amb-right">' +
      '<div class="amb-wx">' + App.icon(w.cond, 44) + '<span class="num">' + w.temp + '°</span><small>' + w.summary + '</small></div>' +
      (next ? '<div class="amb-next" style="' + App.pstyle(App.evColor(next)) + '"><i></i>' + App.esc(next.title) + ' · ' + App.fmt.time(next.start) + '</div>' : '') +
      '<div class="amb-who">' + D.people.map(function (p) { return App.avatar(p, 34, p.home ? '' : 'avatar--away'); }).join('') + '</div>' +
      '</div>');
  }
  // Pixel clock over the scene's sky
  function sceneInfo() {
    var n = App.now(), w = App.weatherNow(), next = App.nextEvent(), full = lockCfg().details !== 'clock';
    return '<div class="px-time">' + App.fmt.time(n, false) + '<span class="px-ampm">' + App.fmt.ampm(n) + '</span></div>' +
      '<div class="px-date">' + App.fmt.day(n) + ' · ' + App.fmt.monthShort(n) + ' ' + n.getDate() + '</div>' +
      (full && !w.none ? '<div class="px-line">' + App.icon(w.cond, 26) + '<span>' + w.temp + '° ' + App.esc(w.summary || '') + '</span></div>' : '') +
      (full && next ? '<div class="px-line px-next"><i style="' + App.pstyle(App.evColor(next)) + '"></i><span>' + App.esc(next.title) + ' · ' + App.fmt.time(next.start) + '</span></div>' : '');
  }
  function nightInfo() {
    var n = App.now(), tomorrow = App.addDays(n, n.getHours() < 6 ? 0 : 1);
    var first = App.timedOn(tomorrow)[0], w = App.weatherNow();
    if (w.none) w = { cond: 'moon', temp: '–' };
    return '<div class="nt-time num">' + App.fmt.time(n, false) + '</div>' +
      (lockCfg().details === 'clock' ? '' : '<div class="nt-line">' + App.icon(w.cond, 26) + ' ' + w.temp + '° · ' + (first ? 'First up ' + App.fmt.rel(first.start).toLowerCase() + ': <b>' + App.esc(first.title) + '</b> ' + App.fmt.time(first.start) + ' · ' + App.person(first.people[0]).name : 'Nothing early tomorrow') + '</div>');
  }

  // ------------------------------------------------------------ the scene video
  function sceneWanted() { return App.sceneIsNight() ? 'night' : 'day'; }
  // Decoder health: older tablets' video decoders wear out on a long loop (one failed after ~1 h).
  // So: a fresh decoder every 20 min, the decoder released while the dashboard is in use, and on a
  // decode error retry, then try the other format, then settle on the still picture.
  var dec = { started: 0, errors: [], gaveUp: false, said: false };
  var FRESH_MS = 20 * 60000;
  function poster(v, which) {
    v.poster = SCENES[which] + (variant() === '-ipad' ? '-ipad' : '') + '.jpg' + VER;
    v.style.backgroundImage = 'url(' + v.poster + ')'; // shows until (or if) the video can play
    var bg = $('#ambient .amb-scene-bg'); if (bg) bg.style.backgroundImage = 'url(' + v.poster + ')';
  }
  // 'whole' shows the entire scene (blurred copy fills the leftover space, e.g. on a 4:3 iPad);
  // 'fill' crops it to fill the screen. Default: whole picture unless the screen is 16:10 anyway.
  App.sceneFit = function () { return App.displayCfg().lock.fit || (/Android/i.test(navigator.userAgent) ? 'fill' : 'whole'); };
  function release(v) {
    v.pause();
    if (v.getAttribute('src')) { v.removeAttribute('src'); try { v.load(); } catch (e) {} }
    v.dataset.which = '';
  }
  function load(v, which) {
    release(v);
    v.dataset.which = which; poster(v, which);
    v.src = srcFor(v, which);
    dec.started = Date.now(); dec.said = false;
  }
  function start(v) { var p = v.play(); if (p && p.catch) p.catch(function (e) { report('play-blocked', (e && e.name) + ': ' + (e && e.message)); }); }
  function playScene() {
    var v = amb.scene, which = sceneWanted();
    poster(v, which);
    // At night the scene is dimmed to the night-mode brightness
    var k = App.LEVELS[App.displayCfg().night.level] || App.LEVELS.medium;
    $('#ambient').style.setProperty('--scene-dim', which === 'night' && App.isNight() ? (0.35 + k * 0.65).toFixed(2) : '1');
    $('#ambient').classList.toggle('is-night-scene', which === 'night');
    if (dec.gaveUp) return; // still picture until the next lock
    var wantSrc = srcFor(v, which);
    if (v.dataset.which !== which || !v.getAttribute('src') || v.getAttribute('src') !== wantSrc || (!hd() && Date.now() - dec.started > FRESH_MS)) load(v, which);
    if (v.paused) start(v);
  }
  function onError() {
    var v = amb.scene, e = v.error, now = Date.now();
    dec.errors = dec.errors.filter(function (t) { return now - t < 15 * 60000; }).concat([now]);
    report('video-error', fmt + ' code ' + (e && e.code) + ' ' + ((e && e.message) || '') + ' · #' + dec.errors.length);
    if (App.mode !== 'ambient') return release(v);
    var which = v.dataset.which || sceneWanted();
    if (hd()) { hdFailed = true; report('hd-failed', 'falling back to the light video'); release(v); setTimeout(function () { if (App.mode === 'ambient') { load(v, which); start(v); } }, 1000); return; }
    if (dec.errors.length >= 3) { dec.gaveUp = true; release(v); poster(v, which); report('gave-up', 'showing the still picture'); return; }
    if (dec.errors.length === 2) fmt = fmt === 'mp4' ? 'webm' : 'mp4';
    release(v); poster(v, which);
    setTimeout(function () { if (App.mode === 'ambient' && !dec.gaveUp) { load(v, which); start(v); } }, 3000);
  }
  // Unlocked: free the decoder (and start fresh next time)
  function stopScene() { if (amb.scene) release(amb.scene); dec.gaveUp = false; }
  // Some tablets only allow video after a tap: play/stop once on the first tap so later lock
  // screens can start on their own.
  function prime() {
    if (primed || !amb.scene) return;
    primed = true;
    var v = amb.scene;
    if (!v.getAttribute('src')) { v.dataset.which = sceneWanted(); v.src = srcFor(v, v.dataset.which); }
    var p = v.play();
    if (p && p.then) p.then(function () { if (App.mode !== 'ambient') release(v); }).catch(function (e) { primed = false; report('prime-failed', (e && e.name) + ': ' + (e && e.message)); });
  }
  // Tell the Mac (logs/server.log) when the scene video can't play, so problems are visible remotely
  function report(event, detail) {
    try {
      var v = amb.scene;
      fetch('/api/home/lockdiag', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-HQ': '1' },
        body: JSON.stringify({ event: event, detail: detail + (v ? ' · ready ' + v.readyState + ' net ' + v.networkState + ' src ' + (v.dataset.which || '-') : ''), ua: navigator.userAgent }) }).catch(function () {});
    } catch (e) {}
  }

  // ------------------------------------------------------------ paint
  function paint() {
    if (App.mode === 'ambient') {
      var scene = sceneOn();
      $('#ambient').classList.toggle('is-scene', scene);
      $('#ambient').classList.toggle('is-classic', lockCfg().font === 'classic');
      $('#ambient').classList.toggle('is-whole', App.sceneFit() === 'whole');
      if (scene) $('#ambient .px-info').innerHTML = sceneInfo();
      else $('#ambient .amb-info').innerHTML = ambientInfo();
    }
    if (App.mode === 'night') $('#night .nt-inner').innerHTML = nightInfo();
  }
  function applyStyle() {
    if (App.mode !== 'ambient') { stopScene(); amb.show.stop(); return; }
    if (sceneOn()) { amb.show.stop(); playScene(); }
    else { stopScene(); if (!amb.show.timer) { amb.show.start(); if (!amb.show.timer) amb.show.restart(); } }
    paint();
  }

  // Nudge static content a few px every minute so nothing sits still for hours (image retention)
  function pixelShift() {
    var x = Math.round(Math.random() * 8 - 4), y = Math.round(Math.random() * 8 - 4);
    App.$$('.amb-info, .nt-inner, .px-info').forEach(function (el) { el.style.transform = 'translate(' + x + 'px,' + y + 'px)'; });
  }

  App.on('ready', function () {
    $('#ambient').innerHTML = '<div class="amb-stage"></div><div class="amb-scrim"></div><div class="amb-info"></div>' +
      '<div class="amb-scene-bg"></div><video class="amb-scene" muted loop playsinline preload="auto" disableremoteplayback></video><div class="px-scrim"></div><div class="px-info"></div>';
    $('#night').innerHTML = '<div class="nt-inner"></div>';
    amb.show = new App.Slideshow($('#ambient .amb-stage'), { layout: 'cover', captions: false, interval: 14000 });
    amb.scene = $('#ambient .amb-scene');
    amb.scene.muted = true; amb.scene.defaultMuted = true;
    $('#ambient').addEventListener('click', function () { App.setMode('day'); App.go('home'); });
    $('#night').addEventListener('click', function () { App.setMode('day'); App.go('home'); });
    // Android only counts a finished tap (not a touch-down) as permission to play video
    document.addEventListener('touchend', prime, true);
    document.addEventListener('click', prime, true);
    amb.scene.addEventListener('error', onError);
    amb.scene.addEventListener('playing', function () { if (!dec.said) { dec.said = true; report('video-playing', fmt + ' ' + amb.scene.videoWidth + 'x' + amb.scene.videoHeight); } });
  });

  App.on('mode', function (m) {
    clearInterval(shiftTimer);
    applyStyle();
    if (m === 'night') paint();
    if (m === 'ambient' || m === 'night') shiftTimer = setInterval(pixelShift, 60000);
    App.resetIdle();
  });
  // Every minute while locked, and when the schedule or settings change: right scene + fresh clock
  App.on('lockstyle', applyStyle);
  App.on('minute', paint);
})();
