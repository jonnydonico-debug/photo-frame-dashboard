// Home controls: scenes, lights, shades, locks, garage and climate. Same devices as the frame's
// Home tab; changes run the matching Apple Home shortcut on the Mac mini.
(function () {
  'use strict';
  var D = window.DATA;
  function devs() { return D.devices || []; }
  function dev(id) { return devs().filter(function (d) { return d.id === id; })[0]; }
  function state(d) {
    if (d.type === 'light') return d.on ? (d.level || 100) + '%' : 'Off';
    if (d.type === 'blind') return d.pos === 0 ? 'Closed' : d.pos === 100 ? 'Open' : d.pos + '% open';
    if (d.type === 'lock') return d.locked ? 'Locked' : 'Unlocked';
    if (d.type === 'garage') return d.state === 'open' ? 'Open' : 'Closed';
    return d.on ? 'On' : 'Off';
  }
  function isOn(d) { return d.type === 'light' ? d.on : d.type === 'blind' ? d.pos > 0 : d.type === 'lock' ? !d.locked : d.type === 'garage' ? d.state === 'open' : !!d.on; }
  var ICON = { light: 'bulb', blind: 'blinds', lock: 'lock', garage: 'garage' };
  function tile(d) {
    return '<button class="dv dv--' + d.type + (isOn(d) ? ' is-on' : '') + '" data-dev="' + App.esc(d.id) + '">' + App.icon(d.type === 'lock' && !d.locked ? 'unlock' : ICON[d.type] || 'bolt', 22) +
      '<b>' + App.esc(d.name) + '</b><small>' + state(d) + '</small></button>';
  }
  function set(id, patch) {
    var d = dev(id); if (!d) return;
    Object.assign(d, patch); App.save(); App.rerender();
  }
  function scene(id) {
    var s = (D.scenes || []).filter(function (x) { return x.id === id; })[0]; if (!s) return;
    Object.keys(s.set || {}).forEach(function (k) { var d = dev(k), v = s.set[k]; if (!d) return; if (d.type === 'blind') d.pos = v; else if (v === 0) d.on = false; else { d.on = true; d.level = v; } });
    if (id === 'away' || id === 'night') devs().forEach(function (d) { if (d.type === 'lock') d.locked = true; });
    if (window.HQ && HQ.scene) HQ.scene(id);
    App.save(); App.rerender();
    App.toast(App.esc(s.name) + ' scene on', { icon: s.icon || 'bolt', ms: 1800 });
  }
  function open(d) {
    if (d.type === 'light' || d.type === 'blind') {
      var v = d.type === 'light' ? (d.on ? d.level || 100 : 0) : d.pos;
      App.sheet('<div class="sh-pad"><h2 class="sh-h">' + App.esc(d.name) + '</h2><p class="sh-p" data-v>' + state(d) + '</p>' +
        '<input class="big-range" type="range" min="0" max="100" step="5" value="' + v + '" aria-label="Level">' +
        '<div class="sh-actions"><button class="btn" data-off>' + (d.type === 'light' ? 'Turn off' : 'Close') + '</button><button class="btn btn--solid" data-full>' + (d.type === 'light' ? 'Full' : 'Open') + '</button></div></div>', {
        onMount: function (s, close) {
          var r = s.querySelector('input');
          function apply(x) { if (d.type === 'light') set(d.id, x ? { on: true, level: x } : { on: false }); else set(d.id, { pos: x }); s.querySelector('[data-v]').textContent = state(d); }
          r.addEventListener('change', function () { apply(+r.value); });
          r.addEventListener('input', function () { s.querySelector('[data-v]').textContent = d.type === 'light' ? (+r.value ? r.value + '%' : 'Off') : r.value + '%'; });
          s.querySelector('[data-off]').onclick = function () { apply(0); close(); };
          s.querySelector('[data-full]').onclick = function () { apply(100); close(); };
        }
      });
      return;
    }
    if (d.type === 'lock') {
      if (d.locked) return App.confirm('Unlock ' + App.esc(d.name) + '?', 'Anyone at the door can come in.', 'Unlock', function () { set(d.id, { locked: false }); });
      return set(d.id, { locked: true });
    }
    if (d.type === 'garage') return App.confirm((d.state === 'open' ? 'Close ' : 'Open ') + App.esc(d.name) + '?', '', d.state === 'open' ? 'Close' : 'Open', function () { set(d.id, { state: d.state === 'open' ? 'closed' : 'open' }); });
    set(d.id, { on: !d.on });
  }
  function climate() {
    var C = D.climate || {};
    if (!C.enabled) return '';
    var unit = D.settings && D.settings.units === 'celsius' ? '°' : '°';
    return '<div class="card cl"><div class="card-h">' + App.icon('thermo', 18) + '<span>Climate</span><small>Inside ' + (C.current != null ? C.current + unit : '–') + '</small></div>' +
      '<div class="cl-row"><button data-cl="-1" aria-label="Cooler">' + App.icon('minus', 22) + '</button><b>' + C.set + unit + '</b><button data-cl="1" aria-label="Warmer">' + App.icon('plus', 22) + '</button></div>' +
      '<div class="seg seg--full">' + ['off', 'heat', 'cool', 'auto'].map(function (m) { return '<button data-clm="' + m + '" class="' + (C.mode === m ? 'is-on' : '') + '">' + m.charAt(0).toUpperCase() + m.slice(1) + '</button>'; }).join('') + '</div></div>';
  }

  App.screen('home', {
    tab: 'more',
    render: function (el) {
      var rooms = (D.rooms || []).slice(), list = devs(), sc = D.scenes || [];
      var on = list.filter(function (d) { return d.type === 'light' && d.on; }).length;
      var body = '';
      if (!list.length && !sc.length && !(D.climate && D.climate.enabled)) {
        body = '<div class="empty">' + App.icon('bulb', 30) + '<b>Nothing set up yet</b><span>Add your Apple Home lights, locks and scenes in Admin → Lights &amp; Home, and they’ll show up here and on the frame.</span></div>';
      } else {
        body = (sc.length ? '<div class="sec-l">Scenes</div><div class="scenes">' + sc.map(function (s) { return '<button data-scene="' + App.esc(s.id) + '">' + App.icon(s.icon || 'bolt', 20) + '<span>' + App.esc(s.name) + '</span></button>'; }).join('') + '</div>' : '') +
          climate() +
          rooms.concat(list.some(function (d) { return !rooms.some(function (r) { return r.id === d.room; }); }) ? [{ id: '__other', name: 'Other' }] : []).map(function (r) {
            var ds = list.filter(function (d) { return r.id === '__other' ? !rooms.some(function (x) { return x.id === d.room; }) : d.room === r.id; });
            return ds.length ? '<div class="sec-l">' + App.esc(r.name) + '</div><div class="dvs">' + ds.map(tile).join('') + '</div>' : '';
          }).join('') +
          (on ? '<button class="btn btn--wide" data-alloff>' + App.icon('bulb', 18) + 'Turn off all lights</button>' : '');
      }
      el.innerHTML = '<button class="back" data-go="more">' + App.icon('left', 20) + 'More</button>' +
        App.head('Home', list.length ? (on ? on + (on === 1 ? ' light on' : ' lights on') : 'All lights off') : '') + body;
      if (!el.dataset.wired) {
        el.dataset.wired = '1';
        el.addEventListener('click', function (e) {
          var t;
          if ((t = e.target.closest('[data-go]'))) return App.go(t.dataset.go);
          if ((t = e.target.closest('[data-scene]'))) return scene(t.dataset.scene);
          if ((t = e.target.closest('[data-dev]'))) { var d = dev(t.dataset.dev); if (d) open(d); return; }
          if (e.target.closest('[data-alloff]')) { devs().forEach(function (d) { if (d.type === 'light') d.on = false; }); App.save(); App.rerender(); return App.toast('All lights off', { icon: 'bulb' }); }
          if ((t = e.target.closest('[data-cl]'))) { var C = D.climate; C.set = Math.round((C.set + +t.dataset.cl) * 2) / 2; App.save(); return App.rerender(); }
          if ((t = e.target.closest('[data-clm]'))) { D.climate.mode = t.dataset.clm; App.save(); return App.rerender(); }
        });
      }
    }
  });
})();
