// Chores: the same routines as the frame's Chores tab (morning, after school, evening), one group
// per person plus "Anyone". Ticking a chore off earns its stars, exactly like on the frame.
(function () {
  'use strict';
  var D = window.DATA;
  var V = { routine: null };

  function routines() { return D.routines || []; }
  function current() {
    var h = new Date().getHours(), rs = routines();
    for (var i = 0; i < rs.length; i++) if (h >= rs[i].from && h < rs[i].to) return rs[i];
    return rs[rs.length - 1];
  }
  function routine() { return (V.routine && routines().filter(function (r) { return r.id === V.routine; })[0]) || current(); }
  function lanes(r) {
    var ids = [];
    (D.chores || []).forEach(function (c) { if (c.r === r.id && ids.indexOf(c.who) < 0) ids.push(c.who); });
    var order = App.people().map(function (p) { return p.id; }).concat(['any']);
    return ids.sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });
  }
  function laneName(who) { return who === 'any' ? 'Anyone' : App.person(who).name; }

  function render(el) {
    var r = routine(), auto = current();
    if (!r) {
      el.innerHTML = '<button class="back" data-go="more">' + App.icon('left', 20) + 'More</button>' + App.head('Chores') +
        '<div class="empty">' + App.icon('tasks', 40) + '<b>No routines yet</b><span>Set up chores in Admin.</span></div>';
      return wire(el);
    }
    var inR = (D.chores || []).filter(function (c) { return c.r === r.id; });
    var done = inR.filter(function (c) { return c.done; }).length;
    el.innerHTML = '<button class="back" data-go="more">' + App.icon('left', 20) + 'More</button>' +
      App.head('Chores', (r.id === auto.id ? 'Right now · ' : '') + App.esc(r.range || '')) +
      '<div class="seg">' + routines().map(function (x) { return '<button data-r="' + App.esc(x.id) + '" class="' + (x.id === r.id ? 'is-on' : '') + '">' + App.esc(x.name) + '</button>'; }).join('') + '</div>' +
      (inR.length ? '<div class="ch-prog"><b>' + done + '<small>/' + inR.length + '</small></b><div class="ch-bar"><i style="width:' + (done / inR.length * 100) + '%"></i></div><span>done</span></div>' +
        lanes(r).map(function (who) {
          var list = inR.filter(function (c) { return c.who === who; }).sort(function (a, b) { return (a.done - b.done) || ((b.overdue ? 1 : 0) - (a.overdue ? 1 : 0)); });
          var d = list.filter(function (c) { return c.done; }).length;
          var stars = D.stars && D.stars[who] != null ? '<span class="ch-stars">' + App.icon('star', 14, 'i--fill') + D.stars[who] + '</span>' : '';
          return '<div class="sec-l ch-who" style="' + App.pstyle(who === 'any' ? 'family' : who) + '">' + (who === 'any' ? '' : App.avatar(who, 22)) + '<span>' + App.esc(laneName(who)) + '</span>' + stars + '<small>' + d + ' of ' + list.length + '</small></div>' +
            '<div class="group">' + list.map(function (c) {
              return '<button class="ch-row' + (c.done ? ' is-done' : '') + '" data-ch="' + App.esc(c.id) + '"><span class="ch-box">' + (c.done ? App.icon('check', 16) : '') + '</span>' +
                '<span class="ch-e">' + (c.emoji || '') + '</span><span class="ch-t"><b>' + App.esc(c.title) + '</b>' +
                (c.overdue && !c.done ? '<small class="ch-late">Overdue</small>' : c.doneBy ? '<small>by ' + App.esc(App.person(c.doneBy).name) + '</small>' : c.stars ? '<small>' + c.stars + ' ★</small>' : '') + '</span></button>';
            }).join('') + '</div>';
        }).join('') :
        '<div class="empty">' + App.icon('tasks', 40) + '<b>Nothing this ' + App.esc(r.name.toLowerCase()) + '</b><span>Add chores in Admin and they show up here and on the frame.</span></div>');
    wire(el);
  }

  function earnerOf(c, by) { return D.stars && D.stars[c.who] != null ? c.who : (by && D.stars && D.stars[by] != null ? by : null); }
  function complete(c, by) {
    c.done = true;
    if (by) c.doneBy = by;
    var earner = earnerOf(c, by);
    if (earner && c.stars) D.stars[earner] += c.stars;
    App.save(); App.rerender();
    App.toast('<b>' + App.esc(c.title) + '</b> done' + (earner && c.stars ? ' · +' + c.stars + '★ ' + App.esc(App.person(earner).name) : ''), {
      icon: 'check', undo: function () { c.done = false; delete c.doneBy; if (earner && c.stars) D.stars[earner] -= c.stars; App.save(); App.rerender(); }
    });
  }
  function toggle(id) {
    var c = (D.chores || []).filter(function (x) { return x.id === id; })[0]; if (!c) return;
    if (c.done) {
      var earner = earnerOf(c, c.doneBy);
      if (earner && c.stars) D.stars[earner] -= c.stars;
      c.done = false; delete c.doneBy;
      App.save(); App.rerender(); return;
    }
    if (c.who !== 'any') return complete(c, App.me());
    // "Anyone" chores ask who did it, so stars go to the right person
    App.sheet('<div class="sh-pad"><div class="sh-kick">' + (c.emoji || '') + ' ' + App.esc(c.title) + '</div><h2 class="sh-h">Who did it?</h2><div class="sh-list">' + App.people().map(function (p) {
      return '<button data-by="' + App.esc(p.id) + '">' + App.avatar(p, 32) + '<span>' + App.esc(p.name) + '</span></button>';
    }).join('') + '</div></div>', {
      onMount: function (s, close) {
        s.addEventListener('click', function (e) { var b = e.target.closest('[data-by]'); if (b) { close(); complete(c, b.dataset.by); } });
      }
    });
  }

  function wire(el) {
    if (el.dataset.wired) return;
    el.dataset.wired = '1';
    el.addEventListener('click', function (e) {
      var t;
      if ((t = e.target.closest('[data-go]'))) return App.go(t.dataset.go);
      if ((t = e.target.closest('[data-r]'))) { V.routine = t.dataset.r === current().id ? null : t.dataset.r; return App.rerender(); }
      if ((t = e.target.closest('[data-ch]'))) return toggle(t.dataset.ch);
    });
  }

  App.screen('chores', { tab: 'more', render: render, leave: function () { V.routine = null; } });
})();
