// To-do (bottom tab): the same lists as the frame's Reminders tab. "Mine" shows only this phone's
// person (JD or Georgia, picked at sign-in / in Settings); "House" is the shared list.
// To-dos live in DATA.todos. Reminders are the Mac mini's scheduled texts (DATA.reminders, live);
// adding or deleting one goes through /api/home/reminders, like on the frame.
(function () {
  'use strict';
  var D = window.DATA;
  var STEP = 15;
  var V = { seg: null };
  function mine() { var me = App.me(); return me && (me === 'jd' || me === 'georgia' || App.people().some(function (p) { return p.id === me; })) ? me : null; }
  function seg() {
    if (!V.seg) { try { V.seg = localStorage.getItem('hq.app.todoSeg'); } catch (e) {} }
    return V.seg === 'house' || !mine() ? 'house' : 'mine';
  }
  function setSeg(v) { V.seg = v; try { localStorage.setItem('hq.app.todoSeg', v); } catch (e) {} }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function lists() {
    var ppl = App.people().filter(function (p) { return p.id === 'jd' || p.id === 'georgia'; });
    if (!ppl.length) ppl = App.people();
    return ppl.map(function (p) { return { id: p.id, name: p.name, p: p }; }).concat([{ id: 'house', name: 'House', p: null }]);
  }
  function listName(id) { var l = lists().filter(function (x) { return x.id === id; })[0]; return l ? l.name : id; }
  function badge(l, size) {
    return l.p ? App.avatar(l.p, size) : '<span class="av av--house" style="width:' + size + 'px;height:' + size + 'px">' + App.icon('home', Math.round(size * .55)) + '</span>';
  }
  function whenLabel(r) {
    var d = new Date(r.next);
    if (r.repeat && r.repeat !== 'once') return r.repeat + ' · ' + App.fmt.time(d);
    var days = Math.round((App.dayStart(d) - App.dayStart(new Date())) / 864e5);
    return (days >= 7 ? App.fmt.monthShort(d) + ' ' + d.getDate() : App.fmt.rel(d)) + ' · ' + App.fmt.time(d);
  }

  function render(el) {
    var todos = D.todos || [], rems = D.reminders || [], t0 = +App.dayStart(new Date());
    var me = mine(), sg = seg(), list = sg === 'house' ? 'house' : me;
    var l = lists().filter(function (x) { return x.id === list; })[0] || { id: list, name: list === 'house' ? 'House' : App.person(list).name };
    var my = rems.filter(function (r) { return r.list === list; });
    var open = todos.filter(function (t) { return t.list === list && !t.done; });
    var done = todos.filter(function (t) { return t.list === list && t.done && (t.doneAt || 0) >= t0; });
    var count = function (id) { return todos.filter(function (t) { return t.list === id && !t.done; }).length; };
    el.innerHTML = App.head('To-do', sg === 'house' ? 'Shared by everyone at home' : 'Just for you, ' + App.esc(l.name)) +
      '<div class="seg">' + (me ? '<button data-seg="mine" class="' + (sg === 'mine' ? 'is-on' : '') + '">Mine' + (count(me) ? ' · ' + count(me) : '') + '</button>' : '') +
      '<button data-seg="house" class="' + (sg === 'house' ? 'is-on' : '') + '">House' + (count('house') ? ' · ' + count('house') : '') + '</button></div>' +
      (!me ? '<p class="muted pad">Pick who you are in More → Settings to get your own list.</p>' : '') +
      '<div class="rm-add2"><button class="btn" data-addtodo>' + App.icon('plus', 18) + 'To-do</button><button class="btn btn--solid" data-addrem>' + App.icon('bell', 18) + 'Reminder</button></div>' +
      (open.length || done.length ? '<div class="sec-l">To do · ' + open.length + '</div><div class="group">' + open.concat(done).map(function (t) {
        return '<div class="rm-row' + (t.done ? ' is-done' : '') + '"><button class="rm-chk" data-tick="' + App.esc(t.id) + '" aria-label="Done">' + (t.done ? App.icon('check', 14) : '') + '</button>' +
          '<button class="rm-t" data-todo="' + App.esc(t.id) + '"><b>' + App.esc(t.text) + '</b></button></div>';
      }).join('') + '</div>' : '<div class="empty">' + App.icon('check', 36) + '<b>Nothing to do</b><span>Add one with + To-do, or text Dommy “add … to ' + (sg === 'house' ? 'the house' : 'my') + ' to-do list”.</span></div>') +
      (my.length ? '<div class="sec-l">Reminders · texted to ' + (list === 'house' ? 'JD and Georgia' : App.esc(l.name)) + '</div><div class="group">' + my.map(function (r) {
        return '<button class="rm-row" data-rem="' + App.esc(r.id) + '"><span class="rm-ico">' + App.icon('bell', 16) + '</span><span class="rm-t"><b>' + App.esc(r.text) + '</b><small>' + App.esc(whenLabel(r)) + '</small></span></button>';
      }).join('') + '</div>' : '');
    if (!el.dataset.wired) {
      el.dataset.wired = '1';
      el.addEventListener('click', function (e) {
        var b = e.target.closest('button'); if (!b) return;
        if (b.dataset.seg) { setSeg(b.dataset.seg); return App.rerender(); }
        if (b.hasAttribute('data-addtodo')) return addTodo();
        if (b.hasAttribute('data-addrem')) return addReminder();
        if (b.dataset.tick) return tick(b.dataset.tick);
        if (b.dataset.todo) return todoMenu(b.dataset.todo);
        if (b.dataset.rem) return remMenu(b.dataset.rem);
      });
    }
  }
  // New items go on the list that's showing (Mine or House)
  function current() { return seg() === 'house' ? 'house' : mine(); }

  function whoChips(cur) {
    return '<div class="chips">' + lists().map(function (l) {
      return '<button class="chip' + (l.id === cur ? ' is-on' : '') + '" data-list="' + l.id + '">' + App.esc(l.name) + '</button>';
    }).join('') + '</div>';
  }
  function pickList(s, b, st) { st.list = b.dataset.list; App.$$('[data-list]', s).forEach(function (x) { x.classList.toggle('is-on', x === b); }); }

  // ------------------------------------------------------------ to-dos
  function tick(id) {
    D.todos = (D.todos || []).map(function (x) { return x.id === id ? Object.assign({}, x, { done: !x.done, doneAt: x.done ? null : Date.now() }) : x; });
    App.save(); App.rerender();
  }
  function addTodo() {
    var st = { list: current() || 'house' };
    App.sheet('<div class="sh-pad"><h2 class="sh-h">New to-do</h2>' +
      '<label class="fld"><span>What needs doing?</span><input data-f="text" maxlength="200"></label>' +
      '<div class="fld"><span>Whose list</span>' + whoChips(st.list) + '</div>' +
      '<div class="sh-actions"><button class="btn" data-close>Cancel</button><button class="btn btn--solid" data-save>Add</button></div></div>', {
      onMount: function (s, close) {
        var input = s.querySelector('[data-f=text]');
        function save() {
          var text = input.value.trim(); if (!text) { input.focus(); return; }
          D.todos = (D.todos || []).concat([{ id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), list: st.list, text: text, done: false, at: Date.now(), by: App.me() || 'app' }]);
          close(); App.save(); App.rerender();
          App.toast('Added to <b>' + App.esc(listName(st.list)) + '</b>’s to-dos', { icon: 'check', ms: 2200 });
        }
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') save(); });
        s.addEventListener('click', function (e) {
          var b = e.target.closest('button'); if (!b) return;
          if (b.dataset.list) pickList(s, b, st);
          if (b.hasAttribute('data-save')) save();
        });
      }
    });
  }
  function todoMenu(id) {
    var t = (D.todos || []).filter(function (x) { return x.id === id; })[0]; if (!t) return;
    App.sheet('<div class="sh-pad"><div class="sh-kick">' + App.esc(listName(t.list)) + '’s to-do</div><h2 class="sh-h">' + App.esc(t.text) + '</h2>' +
      '<div class="sh-actions"><button class="btn btn--danger" data-del>Delete</button><button class="btn btn--solid" data-done>' + (t.done ? 'Not done yet' : 'Mark done') + '</button></div></div>', {
      onMount: function (s, close) {
        s.querySelector('[data-done]').onclick = function () { close(); tick(id); };
        s.querySelector('[data-del]').onclick = function () {
          var before = D.todos.slice();
          D.todos = D.todos.filter(function (x) { return x.id !== id; });
          close(); App.save(); App.rerender();
          App.toast('Deleted <b>' + App.esc(t.text) + '</b>', { icon: 'x', undo: function () { D.todos = before; App.save(); App.rerender(); } });
        };
      }
    });
  }

  // ------------------------------------------------------------ reminders (texts from the Mac mini)
  function addReminder() {
    var now = new Date(), start = new Date(+now + 60 * 60000);
    start.setMinutes(Math.ceil(start.getMinutes() / STEP) * STEP, 0, 0);
    var st = { list: current() || 'house', day: App.dayStart(start) > App.dayStart(now) ? 1 : 0, time: pad(start.getHours()) + ':' + pad(start.getMinutes()), repeat: 'once' };
    function dateFor(i) { return App.addDays(App.dayStart(new Date()), i); }
    function timeText() { var p = st.time.split(':'); return App.fmt.time(new Date(2000, 0, 1, +p[0], +p[1])); }
    function summary() {
      var d = dateFor(st.day), p = st.time.split(':'); d.setHours(+p[0], +p[1]);
      var when = st.repeat === 'once' ? App.fmt.rel(d) + ' at ' + App.fmt.time(d)
        : (st.repeat === 'daily' ? 'Every day' : st.repeat === 'weekdays' ? 'Weekdays' : 'Every ' + App.fmt.day(d)) + ' at ' + App.fmt.time(d);
      return (st.list === 'house' ? 'Texts JD and Georgia and shows on the frame' : 'Texts ' + listName(st.list)) + ' · ' + when;
    }
    App.sheet('<div class="sh-pad"><h2 class="sh-h">New reminder</h2>' +
      '<label class="fld"><span>Remind about…</span><input data-f="text" maxlength="300"></label>' +
      '<div class="fld"><span>For</span>' + whoChips(st.list) + '</div>' +
      '<div class="fld"><span>Day</span><div class="chips">' + [0, 1, 2, 3, 4, 5, 6].map(function (i) {
        var d = dateFor(i);
        return '<button class="chip' + (i === st.day ? ' is-on' : '') + '" data-day="' + i + '">' + (i < 2 ? App.fmt.rel(d) : App.fmt.dayShort(d) + ' ' + d.getDate()) + '</button>';
      }).join('') + '</div></div>' +
      '<div class="fld"><span>Time</span><div class="stepper"><button data-step="-1" aria-label="Earlier">' + App.icon('minus', 20) + '</button><b data-time></b><button data-step="1" aria-label="Later">' + App.icon('plus', 20) + '</button></div>' +
      '<div class="chips chips--c">' + [['08:00', '8 AM'], ['12:00', 'Noon'], ['17:00', '5 PM'], ['19:00', '7 PM'], ['21:00', '9 PM']].map(function (q) { return '<button class="chip" data-quick="' + q[0] + '">' + q[1] + '</button>'; }).join('') + '</div></div>' +
      '<div class="fld"><span>Repeat</span><div class="chips">' + [['once', 'Once'], ['daily', 'Every day'], ['weekdays', 'Weekdays'], ['weekly', 'Every week']].map(function (r) {
        return '<button class="chip' + (r[0] === st.repeat ? ' is-on' : '') + '" data-rep="' + r[0] + '">' + r[1] + '</button>';
      }).join('') + '</div></div>' +
      '<p class="sh-note" data-sum></p>' +
      '<div class="sh-actions"><button class="btn" data-close>Cancel</button><button class="btn btn--solid" data-save>Set reminder</button></div></div>', {
      onMount: function (s, close) {
        var input = s.querySelector('[data-f=text]');
        function paint() { s.querySelector('[data-time]').textContent = timeText(); s.querySelector('[data-sum]').textContent = summary(); }
        paint();
        s.addEventListener('click', function (e) {
          var b = e.target.closest('button'); if (!b) return;
          if (b.dataset.list) pickList(s, b, st);
          if (b.dataset.day != null) { st.day = +b.dataset.day; App.$$('[data-day]', s).forEach(function (x) { x.classList.toggle('is-on', x === b); }); }
          if (b.dataset.rep) { st.repeat = b.dataset.rep; App.$$('[data-rep]', s).forEach(function (x) { x.classList.toggle('is-on', x === b); }); }
          if (b.dataset.quick) st.time = b.dataset.quick;
          if (b.dataset.step) { var p = st.time.split(':'), m = ((+p[0] * 60 + +p[1] + (+b.dataset.step) * STEP) % 1440 + 1440) % 1440; st.time = pad(Math.floor(m / 60)) + ':' + pad(m % 60); }
          paint();
          if (b.hasAttribute('data-save')) {
            var text = input.value.trim(); if (!text) { input.focus(); return; }
            var d = dateFor(st.day), p2 = st.time.split(':'); d.setHours(+p2[0], +p2[1]);
            if (st.repeat === 'once' && +d <= Date.now()) { App.toast('That time has already passed', { tone: 'error', icon: 'clock', ms: 2500 }); return; }
            b.disabled = true;
            var body = { text: text, list: st.list, time: st.time, repeat: st.repeat };
            if (st.repeat === 'once') body.date = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
            if (st.repeat === 'weekly') body.days = [d.getDay()];
            App.post('/api/home/reminders', body).then(function () {
              close(); App.toast('Reminder set · ' + App.esc(summary()), { icon: 'bell', ms: 3500 });
            }).catch(function (er) { b.disabled = false; App.toast(App.esc(er.message), { tone: 'error', icon: 'bell' }); });
          }
        });
      }
    });
  }
  function remMenu(id) {
    var r = (D.reminders || []).filter(function (x) { return x.id === id; })[0]; if (!r) return;
    var to = r.to === 'house' ? 'Texts JD and Georgia and shows on the frame' : r.to === 'both' ? 'Texts JD and Georgia' : r.to === 'frame' ? 'Shows on the frame' : 'Texts ' + listName(r.to);
    App.sheet('<div class="sh-pad"><div class="sh-kick">' + App.esc(r.kind === 'task' ? 'Scheduled job' : 'Reminder') + '</div><h2 class="sh-h">' + App.esc(r.text) + '</h2>' +
      '<p class="sh-p">' + App.esc(to) + '. Next: ' + App.esc(whenLabel(r)) + '.</p>' +
      '<div class="sh-actions"><button class="btn" data-close>Keep</button><button class="btn btn--danger" data-del>' + (r.repeat === 'once' ? 'Delete' : 'Stop & delete') + '</button></div></div>', {
      onMount: function (s, close) {
        s.querySelector('[data-del]').onclick = function () {
          close();
          App.post('/api/home/reminders', { delete: id }).then(function () { App.toast('Deleted <b>' + App.esc(r.text) + '</b>', { icon: 'bell', ms: 2500 }); })
            .catch(function (er) { App.toast(App.esc(er.message), { tone: 'error', icon: 'bell' }); });
        };
      }
    });
  }

  App.screen('reminders', {
    render: render,
    live: function (keys) { if (keys.indexOf('reminders') > -1) App.rerender(); }
  });
})();
