// Reminders & to-dos: one column each for JD, Georgia and the house.
// - To-dos live in DATA.todos (saved to the Mac mini like notes).
// - Reminders are the Mac mini's scheduled reminders (the same ones set by text). They arrive
//   as DATA.reminders; adding/removing goes through /api/home/reminders. When one is due the
//   Mac texts that person (house reminders text both and pop up on the frame).
(function () {
  'use strict';
  var D = window.DATA;
  var V = { el: null };
  var STEP = 15;

  function lists() {
    var ppl = (D.people || []).filter(function (p) { return p.id === 'jd' || p.id === 'georgia'; });
    return ppl.map(function (p) { return { id: p.id, name: p.name, p: p }; }).concat([{ id: 'house', name: 'House', p: null }]);
  }
  function listName(id) { var l = lists().filter(function (x) { return x.id === id; })[0]; return l ? l.name : id; }
  function badge(l, size) {
    return l.p ? App.avatar(l.p, size) : '<span class="avatar rm-house" style="width:' + size + 'px;height:' + size + 'px">' + App.icon('home', Math.round(size * 0.5)) + '</span>';
  }
  function colStyle(l) { return l.p ? App.pstyle(l.p) : '--c:#9A7B4F;--c-rgb:154 123 79'; }
  function dayStartMs() { var d = new Date(); d.setHours(0, 0, 0, 0); return +d; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function whenLabel(r) {
    var d = new Date(r.next);
    if (r.repeat && r.repeat !== 'once') return r.repeat + ' · ' + App.fmt.time(d);
    var rel = App.fmt.rel(d);
    var days = Math.round((App.dayStart(d) - App.dayStart(new Date())) / 864e5);
    return (days >= 7 ? App.fmt.monthShort(d) + ' ' + d.getDate() : rel) + ' · ' + App.fmt.time(d);
  }
  function post(body) {
    return fetch('/api/home/reminders', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-HQ': '1' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Couldn’t reach the Mac mini'); return j; }); });
  }

  // ------------------------------------------------------------ render
  function render() {
    if (!V.el) return;
    var todos = D.todos || [], rems = D.reminders || [], t0 = dayStartMs();
    // Finished to-dos stay (crossed out) for the rest of the day; anything older than a week is dropped
    var keep = todos.filter(function (t) { return !t.done || t.doneAt > Date.now() - 7 * 864e5; });
    if (keep.length !== todos.length) { D.todos = keep; App.emit('data'); todos = keep; }
    var online = window.HQ && HQ.online && HQ.online();
    V.el.innerHTML = '<div class="rm">' +
      '<header class="rm-head"><h2 class="serif">Reminders</h2><span class="label">To-dos and reminders · texts go to whoever they’re for</span></header>' +
      '<div class="rm-cols">' + lists().map(function (l) {
        var mine = rems.filter(function (r) { return r.list === l.id; });
        var open = todos.filter(function (t) { return t.list === l.id && !t.done; });
        var done = todos.filter(function (t) { return t.list === l.id && t.done && t.doneAt >= t0; });
        return '<section class="card rm-col" style="' + colStyle(l) + '">' +
          '<header class="rm-col-h">' + badge(l, 48) + '<div><h3>' + App.esc(l.name) + '</h3><small>' +
            (open.length ? open.length + ' to do' : 'All done') + (mine.length ? ' · ' + mine.length + ' reminder' + (mine.length > 1 ? 's' : '') : '') + '</small></div></header>' +
          '<div class="rm-scroll">' +
            '<div class="rm-sec"><span class="label">' + App.icon('bell', 16) + 'Reminders</span>' +
              (mine.length ? mine.map(function (r) {
                return '<button class="rm-rem" data-rem="' + App.esc(r.id) + '"><span class="rm-when">' + App.esc(whenLabel(r)) + '</span>' +
                  '<span class="rm-text">' + (r.kind === 'task' ? '🗓️ ' : '') + App.esc(r.text) + '</span></button>';
              }).join('') : '<p class="rm-empty">None set</p>') + '</div>' +
            '<div class="rm-sec"><span class="label">' + App.icon('check', 16) + 'To-do</span>' +
              (open.length || done.length ? open.concat(done).map(function (t) {
                return '<div class="rm-todo' + (t.done ? ' is-done' : '') + '"><button class="rm-check" data-tick="' + App.esc(t.id) + '" aria-label="Done">' + (t.done ? App.icon('check', 22) : '') + '</button>' +
                  '<button class="rm-ttext" data-todo="' + App.esc(t.id) + '">' + App.esc(t.text) + '</button></div>';
              }).join('') : '<p class="rm-empty">Nothing to do</p>') + '</div>' +
          '</div>' +
          '<footer class="rm-add"><button class="btn" data-addtodo="' + l.id + '">' + App.icon('plus', 22) + 'To-do</button>' +
            '<button class="btn btn--solid" data-addrem="' + l.id + '"' + (online ? '' : ' disabled') + '>' + App.icon('bell', 22) + 'Reminder</button></footer>' +
        '</section>';
      }).join('') + '</div></div>';
  }

  // ------------------------------------------------------------ to-dos
  function whoPicker(cur) {
    return '<div class="add-who rm-who">' + lists().map(function (l) {
      return '<button class="who-btn' + (l.id === cur ? ' is-on' : '') + '" data-list="' + l.id + '" style="' + colStyle(l) + '">' + badge(l, 52) + '<span>' + App.esc(l.name) + '</span></button>';
    }).join('') + '</div>';
  }
  function addTodo(list) {
    var st = { list: list };
    App.sheet('<div class="sheet-pad add"><div class="label">New to-do</div>' +
      '<input class="big-input serif" placeholder="What needs doing?" data-f="text" maxlength="200">' +
      '<div class="label">Whose list</div>' + whoPicker(list) +
      '<div class="sheet-actions"><button class="btn btn--ghost" data-close>Cancel</button><button class="btn btn--solid" data-save>Add</button></div></div>', {
      cls: 'sheet--wide',
      onMount: function (s, close) {
        var input = s.querySelector('[data-f=text]');
        setTimeout(function () { input.focus(); }, 50);
        function save() {
          var text = input.value.trim(); if (!text) { input.focus(); return; }
          var t = { id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), list: st.list, text: text, done: false, at: Date.now(), by: 'frame' };
          D.todos = (D.todos || []).concat([t]);
          close(); render(); App.emit('data');
          App.toast('Added to <b>' + App.esc(listName(st.list)) + '</b>’s to-dos', { icon: 'check', ms: 2500 });
        }
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') save(); });
        s.addEventListener('click', function (e) {
          var b = e.target.closest('button'); if (!b) return;
          if (b.dataset.list) { st.list = b.dataset.list; App.$$('[data-list]', s).forEach(function (x) { x.classList.toggle('is-on', x === b); }); }
          if (b.hasAttribute('data-save')) save();
        });
      }
    });
  }
  function tick(id) {
    var t = (D.todos || []).filter(function (x) { return x.id === id; })[0]; if (!t) return;
    D.todos = D.todos.map(function (x) { return x.id === id ? Object.assign({}, x, { done: !x.done, doneAt: x.done ? null : Date.now() }) : x; });
    render(); App.emit('data');
  }
  function todoMenu(id) {
    var t = (D.todos || []).filter(function (x) { return x.id === id; })[0]; if (!t) return;
    App.sheet('<div class="sheet-pad"><div class="label">' + App.esc(listName(t.list)) + '’s to-do</div><h2 class="serif sheet-h">' + App.esc(t.text) + '</h2>' +
      '<div class="sheet-actions"><button class="btn btn--ghost" data-del>Delete</button><button class="btn btn--solid" data-done>' + (t.done ? 'Not done yet' : 'Mark done') + '</button></div></div>', {
      onMount: function (s, close) {
        s.addEventListener('click', function (e) {
          var b = e.target.closest('button'); if (!b) return;
          if (b.hasAttribute('data-done')) { close(); tick(id); }
          if (b.hasAttribute('data-del')) {
            var before = D.todos.slice();
            D.todos = D.todos.filter(function (x) { return x.id !== id; });
            close(); render(); App.emit('data');
            App.toast('Deleted <b>' + App.esc(t.text) + '</b>', { icon: 'x', undo: function () { D.todos = before; render(); App.emit('data'); } });
          }
        });
      }
    });
  }

  // ------------------------------------------------------------ reminders
  function addReminder(list) {
    var now = new Date(), start = new Date(+now + 60 * 60000);
    start.setMinutes(Math.ceil(start.getMinutes() / STEP) * STEP, 0, 0);
    var st = { list: list, day: start.getDate() !== now.getDate() ? 1 : 0, time: pad(start.getHours()) + ':' + pad(start.getMinutes()), repeat: 'once' };
    var days = [0, 1, 2, 3, 4, 5, 6];
    var quick = [['08:00', '8 AM'], ['12:00', 'Noon'], ['17:00', '5 PM'], ['19:00', '7 PM'], ['21:00', '9 PM']];
    function dateFor(i) { var d = App.addDays(App.dayStart(new Date()), i); return d; }
    function summary() {
      var d = dateFor(st.day), p = st.time.split(':'); d.setHours(+p[0], +p[1]);
      var when = st.repeat === 'once' ? App.fmt.rel(d) + ' at ' + App.fmt.time(d)
        : (st.repeat === 'daily' ? 'Every day' : st.repeat === 'weekdays' ? 'Weekdays' : 'Every ' + App.fmt.day(d)) + ' at ' + App.fmt.time(d);
      var to = st.list === 'house' ? 'Texts JD and Georgia and shows here' : 'Texts ' + listName(st.list);
      return to + ' · ' + when;
    }
    function timeText() { var p = st.time.split(':'), d = new Date(); d.setHours(+p[0], +p[1]); return App.fmt.time(d).split(' '); }
    App.sheet('<div class="sheet-pad add rm-sheet"><div class="label">New reminder</div>' +
      '<input class="big-input serif" placeholder="Remind about…" data-f="text" maxlength="300">' +
      '<div class="label">For</div>' + whoPicker(list) +
      '<div class="add-row"><div><div class="label">Day</div><div class="chips">' + days.map(function (i) {
        var d = dateFor(i);
        return '<button class="chip' + (i === st.day ? ' is-on' : '') + '" data-day="' + i + '">' + (i < 2 ? App.fmt.rel(d) : App.fmt.dayShort(d) + ' ' + d.getDate()) + '</button>';
      }).join('') + '</div></div></div>' +
      '<div class="add-row rm-timerow"><div><div class="label">Time</div><div class="rm-time"><button class="st-step" data-step="-1" aria-label="Earlier">' + App.icon('minus', 26) + '</button>' +
        '<div class="st-clock"><b class="num" data-tclock></b><span data-tampm></span></div><button class="st-step" data-step="1" aria-label="Later">' + App.icon('plus', 26) + '</button></div></div>' +
        '<div><div class="label">Quick</div><div class="chips">' + quick.map(function (q) { return '<button class="chip chip--ghost" data-quick="' + q[0] + '">' + q[1] + '</button>'; }).join('') + '</div></div></div>' +
      '<div class="add-row"><div><div class="label">Repeat</div><div class="chips">' + [['once', 'Once'], ['daily', 'Every day'], ['weekdays', 'Weekdays'], ['weekly', 'Every week']].map(function (r) {
        return '<button class="chip' + (r[0] === st.repeat ? ' is-on' : '') + '" data-rep="' + r[0] + '">' + r[1] + '</button>';
      }).join('') + '</div></div></div>' +
      '<p class="rm-sum" data-sum></p>' +
      '<div class="sheet-actions"><button class="btn btn--ghost" data-close>Cancel</button><button class="btn btn--solid" data-save>Set reminder</button></div></div>', {
      cls: 'sheet--wide',
      onMount: function (s, close) {
        var input = s.querySelector('[data-f=text]');
        function paint() {
          var tt = timeText();
          s.querySelector('[data-tclock]').textContent = tt[0]; s.querySelector('[data-tampm]').textContent = tt[1];
          s.querySelector('[data-sum]').textContent = summary();
        }
        paint();
        setTimeout(function () { input.focus(); }, 50);
        s.addEventListener('click', function (e) {
          var b = e.target.closest('button'); if (!b) return;
          if (b.dataset.list) { st.list = b.dataset.list; App.$$('[data-list]', s).forEach(function (x) { x.classList.toggle('is-on', x === b); }); }
          if (b.dataset.day != null) { st.day = +b.dataset.day; App.$$('[data-day]', s).forEach(function (x) { x.classList.toggle('is-on', x === b); }); }
          if (b.dataset.rep) { st.repeat = b.dataset.rep; App.$$('[data-rep]', s).forEach(function (x) { x.classList.toggle('is-on', x === b); }); }
          if (b.dataset.quick) st.time = b.dataset.quick;
          if (b.dataset.step) { var m = (App.toMin(st.time) + (+b.dataset.step) * STEP + 1440) % 1440; m = Math.round(m / STEP) * STEP % 1440; st.time = pad(Math.floor(m / 60)) + ':' + pad(m % 60); }
          paint();
          if (b.hasAttribute('data-save')) {
            var text = input.value.trim(); if (!text) { input.focus(); return; }
            var d = dateFor(st.day), p = st.time.split(':'); d.setHours(+p[0], +p[1]);
            if (st.repeat === 'once' && +d <= Date.now()) { App.toast('That time has already passed', { tone: 'error', icon: 'clock', ms: 2500 }); return; }
            b.disabled = true;
            var body = { text: text, list: st.list, time: st.time, repeat: st.repeat };
            if (st.repeat === 'once') body.date = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
            if (st.repeat === 'weekly') body.days = [d.getDay()];
            post(body).then(function () {
              close();
              App.toast('Reminder set · ' + App.esc(summary()), { icon: 'bell', ms: 3500 });
            }).catch(function (er) { b.disabled = false; App.toast(App.esc(er.message), { tone: 'error', icon: 'bell' }); });
          }
        });
      }
    });
  }
  function remMenu(id) {
    var r = (D.reminders || []).filter(function (x) { return x.id === id; })[0]; if (!r) return;
    var to = r.to === 'house' ? 'Texts JD and Georgia and shows on the frame' : r.to === 'both' ? 'Texts JD and Georgia' : r.to === 'frame' ? 'Shows on the frame' : 'Texts ' + listName(r.to);
    App.sheet('<div class="sheet-pad"><div class="label">' + App.esc(r.kind === 'task' ? 'Scheduled job' : 'Reminder') + ' · ' + App.esc(r.when) + '</div><h2 class="serif sheet-h">' + App.esc(r.text) + '</h2>' +
      '<p class="rm-sum">' + App.esc(to) + '. Next: ' + App.esc(whenLabel(r)) + '.</p>' +
      '<div class="sheet-actions"><button class="btn btn--ghost" data-close>Keep</button><button class="btn btn--solid" data-del>' + (r.repeat === 'once' ? 'Delete reminder' : 'Stop repeating & delete') + '</button></div></div>', {
      onMount: function (s, close) {
        s.querySelector('[data-del]').addEventListener('click', function () {
          close();
          post({ delete: id }).then(function () { App.toast('Deleted <b>' + App.esc(r.text) + '</b>', { icon: 'bell', ms: 2500 }); })
            .catch(function (er) { App.toast(App.esc(er.message), { tone: 'error', icon: 'bell' }); });
        });
      }
    });
  }

  App.register('reminders', {
    show: function (el) {
      if (!V.el) {
        V.el = el;
        el.addEventListener('click', function (e) {
          var b = e.target.closest('button'); if (!b) return;
          if (b.dataset.addtodo) addTodo(b.dataset.addtodo);
          else if (b.dataset.addrem) addReminder(b.dataset.addrem);
          else if (b.dataset.tick) tick(b.dataset.tick);
          else if (b.dataset.todo) todoMenu(b.dataset.todo);
          else if (b.dataset.rem) remMenu(b.dataset.rem);
        });
      }
      render();
    }
  });
  App.on('live', function (keys) { if (App.current === 'reminders' && keys.indexOf('reminders') > -1) render(); });
})();
