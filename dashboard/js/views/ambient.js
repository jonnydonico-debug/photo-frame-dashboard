// Lock screen. Two overlays:
//  - #ambient: the wallpaper with a clock. Wallpaper is the Henley Gate pixel scene (a day and a
//    night video that follow the night-mode schedule) or the photo slideshow.
//  - #night: the dim red clock (no blue light), used at night when Settings says so.
// Tap anywhere to unlock. Settings → Lock screen picks the look.
(function () {
  'use strict';
  var D = window.DATA, $ = App.$;
  var amb = { show: null, scene: null }, shiftTimer = null, primed = false;
  var SCENES = { day: '/lock/henley-day.mp4', night: '/lock/henley-night.mp4' };

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
  function playScene() {
    var v = amb.scene, which = sceneWanted();
    if (v.dataset.which !== which) {
      v.dataset.which = which;
      v.poster = SCENES[which].replace('.mp4', '.jpg');
      v.style.backgroundImage = 'url(' + v.poster + ')'; // shows until (or if) the video can play
      v.src = SCENES[which];
    }
    // At night the scene is dimmed to the night-mode brightness
    var k = App.LEVELS[App.displayCfg().night.level] || App.LEVELS.medium;
    $('#ambient').style.setProperty('--scene-dim', which === 'night' && App.isNight() ? (0.35 + k * 0.65).toFixed(2) : '1');
    $('#ambient').classList.toggle('is-night-scene', which === 'night');
    var p = v.play(); if (p && p.catch) p.catch(function () { /* autoplay blocked: the poster still shows */ });
  }
  function stopScene() { if (amb.scene && !amb.scene.paused) amb.scene.pause(); }
  // Some tablets only allow video after a touch: start/stop it once on the first touch so later
  // lock screens can play on their own.
  function prime() {
    if (primed || !amb.scene) return;
    primed = true;
    var v = amb.scene;
    if (!v.src) { v.dataset.which = sceneWanted(); v.src = SCENES[v.dataset.which]; }
    var p = v.play();
    if (p && p.then) p.then(function () { if (App.mode !== 'ambient') v.pause(); }).catch(function () { primed = false; });
  }

  // ------------------------------------------------------------ paint
  function paint() {
    if (App.mode === 'ambient') {
      var scene = sceneOn();
      $('#ambient').classList.toggle('is-scene', scene);
      $('#ambient').classList.toggle('is-classic', lockCfg().font === 'classic');
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
      '<video class="amb-scene" muted loop playsinline preload="auto" disableremoteplayback></video><div class="px-scrim"></div><div class="px-info"></div>';
    $('#night').innerHTML = '<div class="nt-inner"></div>';
    amb.show = new App.Slideshow($('#ambient .amb-stage'), { layout: 'cover', captions: false, interval: 14000 });
    amb.scene = $('#ambient .amb-scene');
    amb.scene.muted = true; amb.scene.defaultMuted = true;
    $('#ambient').addEventListener('click', function () { App.setMode('day'); App.go('home'); });
    $('#night').addEventListener('click', function () { App.setMode('day'); App.go('home'); });
    document.addEventListener('pointerdown', prime, true);
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
