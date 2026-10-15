// Calendar: the next two weeks as an agenda, the same events as the frame's Calendar.
// Events from connected calendars (iCloud / Google) are read-only; ones added here can be deleted.
(function () {
  'use strict';
  var D = window.DATA;
  var DAYS_AHEAD = 14, STEP = 15;

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function evStyle(e) {
    var ps = e.people || [];
    return App.pstyle(!ps.length || ps.length >= App.people().length ? 'family' : ps[0]);
  }
  function names(e) {
    var ps = e.people || [];
    if (!ps.length || ps.length >= App.people().length) return 'Everyone';
    return ps.map(function (id) { return App.person(id).name; }).join(', ');
  }
  function when(e) {
    if (e.allDay) return 'All day';
    return App.fmt.time(e.start) + ' – ' + App.fmt.time(e.end);
  }
  function upcoming() {
    var t0 = App.dayStart(new Date()), t1 = App.addDays(t0, DAYS_AHEAD);
    return (D.events || []).filter(function (e) { return e.end > t0 && e.start < t1; }).sort(function (a, b) { return a.start - b.start; });
  }

  function render(el) {
    var list = upcoming(), now = new Date(), byDay = {};
    list.forEach(function (e) {
      // Multi-day events show on each day they cover
      for (var d = App.dayStart(e.start < App.dayStart(now) ? now : e.start); d < e.end && d < App.addDays(App.dayStart(now), DAYS_AHEAD); d = App.addDays(d, 1)) {
        (byDay[+d] = byDay[+d] || []).push(e);
      }
    });
    var days = Object.keys(byDay).map(Number).sort(function (a, b) { return a - b; });
    el.innerHTML = '<button class="back" data-go="more">' + App.icon('left', 20) + 'More</button>' +
      App.head('Calendar', 'The next two weeks', '<button class="hd-add" data-add aria-label="Add event">' + App.icon('plus', 24) + '</button>') +
      (days.length ? days.map(function (k) {
        var d = new Date(k);
        return '<div class="sec-l">' + App.fmt.rel(d) + ' · ' + App.fmt.monthShort(d) + ' ' + d.getDate() + '</div><div class="group">' + byDay[k].map(function (e) {
          var past = e.end <= now;
          return '<button class="ev-row' + (past ? ' is-past' : '') + '" data-ev="' + App.esc(e.id) + '" style="' + evStyle(e) + '">' +
            '<span class="ev-t">' + (e.allDay ? 'All day' : App.fmt.time(e.start, false) + '<small>' + App.fmt.ampm(e.start) + '</small>') + '</span><i></i>' +
            '<span class="ev-m"><b>' + App.esc(e.title) + '</b><small>' + App.esc([names(e), e.loc].filter(Boolean).join(' · ')) + '</small></span></button>';
        }).join('') + '</div>';
      }).join('') : '<div class="empty quiet"><b>Nothing on the calendar.</b><i>A rare, quiet day.</i><span>Connect iCloud or Google calendars in Admin, or add an event with +.</span></div>');
    if (!el.dataset.wired) {
      el.dataset.wired = '1';
      el.addEventListener('click', function (e) {
        var t;
        if ((t = e.target.closest('[data-go]'))) return App.go(t.dataset.go);
        if (e.target.closest('[data-add]')) return add();
        if ((t = e.target.closest('[data-ev]'))) return open(t.dataset.ev);
      });
    }
  }

  function open(id) {
    var e = (D.events || []).filter(function (x) { return x.id === id; })[0]; if (!e) return;
    App.sheet('<div class="sh-pad" style="' + evStyle(e) + '"><div class="sh-kick">' + App.fmt.rel(e.start) + ' · ' + App.fmt.monthShort(e.start) + ' ' + e.start.getDate() + '</div>' +
      '<h2 class="sh-h">' + App.esc(e.title) + '</h2>' +
      '<div class="ev-facts"><span>' + App.icon('clock', 18) + when(e) + '</span>' +
      (e.loc ? '<span>' + App.icon('pin', 18) + App.esc(e.loc) + '</span>' : '') +
      '<span>' + App.icon('person', 18) + App.esc(names(e)) + '</span>' +
      (e.srcName ? '<span>' + App.icon('calendar', 18) + 'From ' + App.esc(e.srcName) + '</span>' : '') + '</div>' +
      '<div class="sh-actions">' + (e.srcName ? '<button class="btn btn--solid" data-close>Done</button>' :
        '<button class="btn btn--danger" data-del>Delete</button><button class="btn btn--solid" data-close>Done</button>') + '</div></div>', {
      onMount: function (s, close) {
        var del = s.querySelector('[data-del]');
        if (del) del.onclick = function () {
          var i = D.events.indexOf(e); if (i < 0) return close();
          D.events.splice(i, 1); close(); App.save(); App.rerender();
          App.toast('Deleted <b>' + App.esc(e.title) + '</b>', { icon: 'calendar', undo: function () { D.events.push(e); App.save(); App.rerender(); } });
        };
      }
    });
  }

  function add() {
    var now = new Date(), start = new Date(+now + 60 * 60000);
    start.setMinutes(Math.ceil(start.getMinutes() / STEP) * STEP, 0, 0);
    var me = App.me();
    var st = { day: App.dayStart(start) > App.dayStart(now) ? 1 : 0, time: pad(start.getHours()) + ':' + pad(start.getMinutes()), dur: 60, who: me ? [me] : App.people().map(function (p) { return p.id; }) };
    function timeText() { var p = st.time.split(':'); return App.fmt.time(new Date(2000, 0, 1, +p[0], +p[1])); }
    App.sheet('<div class="sh-pad"><h2 class="sh-h">New event</h2>' +
      '<label class="fld"><span>What</span><input data-f="title" maxlength="120" placeholder="Dinner with friends"></label>' +
      '<div class="fld"><span>Who</span><div class="chips">' + App.people().map(function (p) {
        return '<button class="chip' + (st.who.indexOf(p.id) > -1 ? ' is-on' : '') + '" data-who="' + App.esc(p.id) + '">' + App.esc(p.name) + '</button>';
      }).join('') + '</div></div>' +
      '<div class="fld"><span>Day</span><div class="chips">' + [0, 1, 2, 3, 4, 5, 6].map(function (i) {
        var d = App.addDays(App.dayStart(now), i);
        return '<button class="chip' + (i === st.day ? ' is-on' : '') + '" data-day="' + i + '">' + (i < 2 ? App.fmt.rel(d) : App.fmt.dayShort(d) + ' ' + d.getDate()) + '</button>';
      }).join('') + '</div></div>' +
      '<div class="fld"><span>Starts</span><div class="stepper"><button data-step="-1" aria-label="Earlier">' + App.icon('minus', 20) + '</button><b data-time>' + timeText() + '</b><button data-step="1" aria-label="Later">' + App.icon('plus', 20) + '</button></div></div>' +
      '<div class="fld"><span>Length</span><div class="chips">' + [[30, '30 min'], [60, '1 hr'], [120, '2 hr'], [180, '3 hr']].map(function (x) {
        return '<button class="chip' + (x[0] === st.dur ? ' is-on' : '') + '" data-dur="' + x[0] + '">' + x[1] + '</button>';
      }).join('') + '</div></div>' +
      '<div class="sh-actions"><button class="btn" data-close>Cancel</button><button class="btn btn--solid" data-save>Add to calendar</button></div></div>', {
      onMount: function (s, close) {
        var input = s.querySelector('[data-f=title]');
        s.addEventListener('click', function (ev) {
          var b = ev.target.closest('button'); if (!b) return;
          if (b.dataset.who) { var i = st.who.indexOf(b.dataset.who); if (i > -1) st.who.splice(i, 1); else st.who.push(b.dataset.who); b.classList.toggle('is-on', i < 0); }
          if (b.dataset.day != null) { st.day = +b.dataset.day; App.$$('[data-day]', s).forEach(function (x) { x.classList.toggle('is-on', x === b); }); }
          if (b.dataset.dur) { st.dur = +b.dataset.dur; App.$$('[data-dur]', s).forEach(function (x) { x.classList.toggle('is-on', x === b); }); }
          if (b.dataset.step) {
            var p = st.time.split(':'), m = ((+p[0] * 60 + +p[1] + (+b.dataset.step) * STEP) % 1440 + 1440) % 1440;
            st.time = pad(Math.floor(m / 60)) + ':' + pad(m % 60); s.querySelector('[data-time]').textContent = timeText();
          }
          if (b.hasAttribute('data-save')) {
            var title = input.value.trim(); if (!title) { input.focus(); return; }
            var start = App.addDays(App.dayStart(now), st.day), p2 = st.time.split(':');
            start.setHours(+p2[0], +p2[1]);
            var e = { id: D._eid ? D._eid() : 'e' + Date.now().toString(36), title: title, people: st.who.length ? st.who.slice() : App.people().map(function (x) { return x.id; }), start: start, end: new Date(+start + st.dur * 60000) };
            D.events = (D.events || []).concat([e]);
            close(); App.save(); App.rerender();
            App.toast('Added <b>' + App.esc(title) + '</b> · ' + App.fmt.rel(start) + ' ' + App.fmt.time(start), { icon: 'calendar' });
          }
        });
      }
    });
  }

  App.screen('calendar', { tab: 'more', render: render });
})();
